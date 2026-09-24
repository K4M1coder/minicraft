/* tools/cdp.js — client CDP (Chrome DevTools Protocol) minimal, Node pur
   (SANS dépendance npm) : Node 22+ expose une classe `WebSocket` globale,
   compatible navigateur, qui suffit entièrement pour parler à l'extrémité
   /json/version d'un navigateur headless — inutile de recoder le protocole
   RFC 6455 déjà écrit à la main côté jeu (src/net-protocol.js, qui lui sert
   le CÔTÉ SERVEUR de la partie multijoueur, un besoin différent).

   Découverte HTTP (/json/version, /json/list, /json/new, /json/close) +
   une session par cible (onglet) qui envoie des commandes (`envoyer`) et
   relaie les événements (`sur`) — Runtime.evaluate (avec awaitPromise),
   Page.navigate, Page.captureScreenshot, Runtime.consoleAPICalled,
   Log.entryAdded, entre autres : n'importe quelle méthode/domaine CDP
   passe par les mêmes deux fonctions génériques.

   Utilisé par tools/e2e-headless.js (SPEC-BANC-023/024) ; testé sans aucun
   vrai navigateur par tests/spec-banc-headless.js, contre un faux serveur
   WebSocket local (http + WebSocketServer n'existe pas nativement, donc le
   faux serveur y répond lui aussi en HTTP simple sur /json/version puis
   accepte la mise à niveau WebSocket à la main — voir ce fichier de test). */
'use strict';
const http = require('http');

function requeteJSON(port, chemin, methode) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: chemin, method: methode || 'GET' },
      (res) => {
        let brut = '';
        res.on('data', (d) => { brut += d; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error('HTTP ' + res.statusCode + ' sur ' + chemin));
            return;
          }
          try { resolve(brut ? JSON.parse(brut) : null); }
          catch (e) { reject(new Error('réponse non JSON sur ' + chemin + ' : ' + e.message)); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function version(port) { return requeteJSON(port, '/json/version'); }
function listerCibles(port) { return requeteJSON(port, '/json/list'); }
function nouvelOnglet(port, url) { return requeteJSON(port, '/json/new?' + encodeURIComponent(url || 'about:blank'), 'PUT'); }
function fermerOnglet(port, id) { return requeteJSON(port, '/json/close/' + id); }

/* Interroge /json/version jusqu'à ce que le port de débogage distant
   réponde (le navigateur met un instant à ouvrir son serveur CDP après le
   spawn) ou que `delaiMs` soit écoulé. */
async function attendrePortPret(port, delaiMs) {
  const limite = Date.now() + (delaiMs || 15000);
  let derniereErreur = null;
  while (Date.now() < limite) {
    try {
      const v = await version(port);
      if (v && v.webSocketDebuggerUrl) return v;
    } catch (e) { derniereErreur = e; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('le port de débogage distant (' + port + ') n\'a jamais répondu' +
    (derniereErreur ? ' (' + derniereErreur.message + ')' : ''));
}

/* Une session = une connexion WebSocket à UNE cible (page). `envoyer`
   attend la réponse par id, avec son propre délai ; `sur` abonne un
   écouteur à un événement CDP (method sans id dans le message reçu). */
class SessionCDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this._id = 0;
    this._enAttente = new Map();
    this._ecouteurs = new Map();
  }

  connecter(delaiMs) {
    return new Promise((resolve, reject) => {
      let fini = false;
      const minuteur = setTimeout(() => {
        if (fini) return;
        fini = true;
        reject(new Error('délai de connexion CDP dépassé (' + this.wsUrl + ')'));
      }, delaiMs || 15000);
      let ws;
      try { ws = new WebSocket(this.wsUrl); }
      catch (e) { clearTimeout(minuteur); reject(e); return; }
      this.ws = ws;
      ws.addEventListener('open', () => { if (fini) return; fini = true; clearTimeout(minuteur); resolve(); });
      ws.addEventListener('error', () => {
        if (fini) return; fini = true; clearTimeout(minuteur);
        reject(new Error('erreur WebSocket CDP (' + this.wsUrl + ')'));
      });
      ws.addEventListener('message', (ev) => this._recu(ev.data));
      ws.addEventListener('close', () => {
        const erreur = new Error('connexion CDP fermée');
        this._enAttente.forEach((p) => p.reject(erreur));
        this._enAttente.clear();
      });
    });
  }

  _recu(donnee) {
    let msg;
    try { msg = JSON.parse(typeof donnee === 'string' ? donnee : String(donnee)); }
    catch (e) { return; }
    if (msg.id !== undefined) {
      const p = this._enAttente.get(msg.id);
      if (!p) return;
      this._enAttente.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || 'erreur CDP'), { cdp: msg.error }));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) {
      const fns = this._ecouteurs.get(msg.method);
      if (!fns) return;
      fns.forEach((fn) => {
        try { fn(msg.params || {}); }
        catch (e) { /* un écouteur en échec n'interrompt jamais les autres, ni la session */ }
      });
    }
  }

  sur(methode, fn) {
    if (!this._ecouteurs.has(methode)) this._ecouteurs.set(methode, []);
    this._ecouteurs.get(methode).push(fn);
  }

  envoyer(methode, params, delaiMs) {
    if (!this.ws) return Promise.reject(new Error('session CDP non connectée'));
    return new Promise((resolve, reject) => {
      const id = ++this._id;
      const minuteur = setTimeout(() => {
        this._enAttente.delete(id);
        reject(new Error('délai dépassé (' + (delaiMs || 30000) + ' ms) sur ' + methode));
      }, delaiMs || 30000);
      this._enAttente.set(id, {
        resolve: (r) => { clearTimeout(minuteur); resolve(r); },
        reject: (e) => { clearTimeout(minuteur); reject(e); },
      });
      try { this.ws.send(JSON.stringify({ id, method: methode, params: params || {} })); }
      catch (e) { clearTimeout(minuteur); this._enAttente.delete(id); reject(e); }
    });
  }

  fermer() {
    try { if (this.ws) this.ws.close(); } catch (e) { /* déjà fermée */ }
  }
}

module.exports = {
  requeteJSON, version, listerCibles, nouvelOnglet, fermerOnglet, attendrePortPret, SessionCDP,
};
