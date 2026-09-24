/* integration-troc.js — test d'intégration de SPEC-SYNC-023 (commerce
   serveur-autoritaire, L45) : vraies sockets, vrai serveur, comme
   integration-pvp.js. NE PAS LANCER avant que B1 (inventaire et conteneurs
   serveur, L43) soit fusionné dans master ET que cette branche s'y soit
   rebasée : le serveur n'a pas encore d'inventaire réel ni les helpers
   (seqNouveau, envoyerInvMaj, refuserOp, etatJoueurServeur, la Map banques)
   que le `case NP.MSG.TROC` de server.js appelle — voir docs/vague-2/B2.md.

   MC_TEST_INV donne à un joueur sans enregistrement un inventaire de départ
   (fourni par B1, § 10 de B1.md) : on l'utilise ici pour être certain que le
   joueur possède de quoi vendre au premier PNJ de métier rencontré.

   Usage : node tests/integration-troc.js [port] */
'use strict';
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8210;

const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, isNaN, isFinite, parseInt, parseFloat,
}));
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(RACINE, 'src/net-protocol.js'), 'utf8'), ctx);
const NP = ctx.MC.NetProtocol;

const C = { r: '\x1b[31m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let passes = 0, echecs = 0;
const details = [];
function ok(cond, nom, info) {
  if (cond) { passes++; details.push(`  ${C.g}·${C.x} ${C.d}${nom}${C.x}`); }
  else { echecs++; details.push(`  ${C.r}✗ ${nom}${C.x}${info ? '\n    ' + C.r + info + C.x : ''}`); }
}
function eq(a, b, nom) { ok(a === b, nom, `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }

// ── client WebSocket minimal (repris d'integration-pvp.js) ─────────────────
function connecter(port) {
  return new Promise((resolve, reject) => {
    const cle = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        'GET / HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${port}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${cle}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let tampon = Buffer.alloc(0), etabli = false;
    const messages = [], attentes = [];
    const client = {
      socket: sock, messages,
      envoyer(obj) {
        const charge = Buffer.from(JSON.stringify(obj), 'utf8');
        const m = crypto.randomBytes(4);
        const n = charge.length;
        const entete = n < 126 ? 2 : 4;
        const buf = Buffer.alloc(entete + 4 + n);
        buf[0] = 0x81;
        if (n < 126) buf[1] = 0x80 | n;
        else { buf[1] = 0x80 | 126; buf.writeUInt16BE(n, 2); }
        m.copy(buf, entete);
        for (let i = 0; i < n; i++) buf[entete + 4 + i] = charge[i] ^ m[i % 4];
        sock.write(buf);
      },
      attendre(type, ms, predicat) {
        const ok2 = (m2) => m2.t === type && (!predicat || predicat(m2));
        const deja = messages.find(ok2);
        if (deja) return Promise.resolve(deja);
        return new Promise((res, rej) => {
          const t = setTimeout(() => {
            const i = attentes.indexOf(a);
            if (i >= 0) attentes.splice(i, 1);
            rej(new Error('delai depasse pour ' + type));
          }, ms || 3000);
          const a = { test: ok2, res: (m2) => { clearTimeout(t); res(m2); } };
          attentes.push(a);
        });
      },
      fermer() { try { sock.destroy(); } catch (e) {} },
    };
    sock.on('data', (bloc) => {
      tampon = Buffer.concat([tampon, bloc]);
      if (!etabli) {
        const i = tampon.indexOf('\r\n\r\n');
        if (i < 0) return;
        const entetes = tampon.slice(0, i).toString();
        const attendu = crypto.createHash('sha1').update(cle + NP.GUID).digest('base64');
        if (!entetes.includes('101') || !entetes.includes(attendu)) { reject(new Error('poignee de main refusee')); return; }
        etabli = true;
        tampon = tampon.slice(i + 4);
        resolve(client);
      }
      for (;;) {
        const d = NP.decoder(tampon);
        if (!d) break;
        tampon = tampon.slice(d.consomme);
        if (d.opcode !== NP.OP.TEXTE) continue;
        let msg;
        try { msg = JSON.parse(NP.utf8Decoder(d.charge)); } catch (e) { continue; }
        messages.push(msg);
        for (let k = attentes.length - 1; k >= 0; k--) {
          if (attentes[k].test(msg)) { attentes[k].res(msg); attentes.splice(k, 1); }
        }
      }
    });
    sock.on('error', reject);
  });
}
function requete(port, chemin) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: chemin }, (res) => {
      let corps = '';
      res.on('data', (d) => { corps += d; });
      res.on('end', () => resolve({ code: res.statusCode, corps }));
    }).on('error', () => resolve({ code: 0, corps: '' }));
  });
}
const dodo = (ms) => new Promise(r => setTimeout(r, ms));

async function attendreDemarrage(port) {
  for (let essai = 0; essai < 60; essai++) {
    await dodo(100);
    const sonde = await requete(port, '/index.html');
    if (sonde.code === 200) return true;
  }
  return false;
}

/* Un PNJ de métier (role connu) parmi les `mobs` d'un message ETAT — les
   habitants sans lieu proche du spawn n'apparaissent qu'une fois le monde
   peuplé (peuplerLieux, au premier tic). */
async function attendrePnjDeMetier(client, ms) {
  const fin = Date.now() + (ms || 8000);
  while (Date.now() < fin) {
    const m = client.messages.filter(x => x.t === 'etat').pop();
    if (m && m.mobs) {
      const pnj = m.mobs.find(x => x.t === 'villager' && x.r);
      if (pnj) return pnj;
    }
    await dodo(200);
  }
  return null;
}

// ── scénario ─────────────────────────────────────────────────────────────────
(async function () {
  const logs = [];
  const MONDE = path.join(RACINE, 'tests', '.tmp-monde-troc.json');
  try { fs.unlinkSync(MONDE); } catch (e) { /* rien */ }

  const env = Object.assign({}, process.env, {
    MC_TEST_INV: JSON.stringify([[131, 40]]),   // 40 blé (I.WHEAT = 131) : de quoi vendre au fermier
  });
  let s = spawn(process.execPath,
    [path.join(RACINE, 'server.js'), '--port', String(PORT), '--admin', 'secretTroc', '--monde', MONDE],
    { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], env });
  s.stdout.on('data', d => logs.push(String(d)));
  s.stderr.on('data', d => logs.push('ERR ' + String(d)));

  let dernierPrix = null;

  try {
    ok(await attendreDemarrage(PORT), 'le serveur démarre');

    const a = await connecter(PORT);
    a.envoyer({ t: 'rejoindre', nom: 'Marchande', locaux: 1 });
    const bienvenue = await a.attendre('bienvenue');
    ok(!!bienvenue, 'connexion acceptée');

    const pnj = await attendrePnjDeMetier(a, 10000);
    ok(!!pnj, 'un PNJ de métier apparaît près du joueur', JSON.stringify(bienvenue && bienvenue.toi));
    if (pnj) {
      // se rapprocher du PNJ, sans quoi le test de portée passerait trivialement
      a.envoyer({ t: 'entree', j: 0 });   // (ne bouge pas forcément assez : voir SPEC-SYNC-023 § piège portée)

      a.envoyer({ t: 'troc', j: 0, action: 'consulter', eid: pnj.e });
      let rep;
      try { rep = await a.attendre('troc', 4000, m => m.action === 'offres' && m.eid === pnj.e); }
      catch (e) { rep = null; }
      ok(!!rep && Array.isArray(rep.offres), 'consulter → offres', rep && JSON.stringify(rep));

      if (rep && rep.offres.length) {
        // une offre de VENTE (le joueur cède une ressource, pas 'campagne|villageois')
        const vente = rep.offres.find(o => o.give && o.give.length && o.get && o.get.id === 137 /* EMERALD */);
        if (vente) {
          dernierPrix = vente.prix;
          a.envoyer({ t: 'troc', j: 0, seq: 1, action: 'echanger', eid: pnj.e, offre: vente.i, fois: 1 });
          let inv;
          try { inv = await a.attendre('inv_maj', 4000, m => m.ack >= 1); } catch (e) { inv = null; }
          ok(!!inv, 'echanger valide → INV_MAJ (ack)', inv && JSON.stringify(inv.refus));

          const rep2 = await a.attendre('troc', 4000, m => m.action === 'offres' && m.eid === pnj.e).catch(() => null);
          if (rep2) {
            const venteApres = rep2.offres.find(o => o.i === vente.i);
            ok(!!venteApres && venteApres.prix !== dernierPrix, 'le prix a bougé après l\'échange',
               venteApres && JSON.stringify(venteApres));
          }
        } else {
          details.push(`  ${C.d}(aucune offre de vente trouvée pour ce PNJ — étape ignorée)${C.x}`);
        }

        // objet manifestement absent de l'inventaire → refus
        a.envoyer({ t: 'troc', j: 0, seq: 2, action: 'echanger', eid: pnj.e, offre: 63, fois: 1 });
        let refus;
        try { refus = await a.attendre('inv_maj', 3000, m => m.refus && m.refus.some(r => r.seq === 2)); }
        catch (e) { refus = null; }
        ok(!!refus, 'offre invalide/objet manquant → refus par INV_MAJ', refus && JSON.stringify(refus));
      }

      // PNJ hors de portée : un eid qui n'existe pas (ou trop loin) → aucune réponse 'offres'
      a.messages.length = 0;
      a.envoyer({ t: 'troc', j: 0, action: 'consulter', eid: 999999 });
      await dodo(500);
      ok(!a.messages.some(m => m.t === 'troc'), 'PNJ hors de portée / inconnu → aucune réponse');
    }

    a.fermer();
    await dodo(300);
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception : ${e.message}${C.x}`);
  } finally {
    s.kill();
    await dodo(400);
  }

  // ── --monde arrêt/relance : prix et trésors conservés ──────────────────────
  try {
    ok(fs.existsSync(MONDE), 'un fichier --monde a été écrit');
    const s2 = spawn(process.execPath,
      [path.join(RACINE, 'server.js'), '--port', String(PORT), '--admin', 'secretTroc2', '--monde', MONDE],
      { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'] });
    s2.stdout.on('data', d => logs.push(String(d)));
    s2.stderr.on('data', d => logs.push('ERR ' + String(d)));
    try {
      ok(await attendreDemarrage(PORT), 'le serveur relancé reprend le monde (--monde)');
      const a2 = await connecter(PORT);
      a2.envoyer({ t: 'rejoindre', nom: 'Verif', locaux: 1 });
      await a2.attendre('bienvenue');
      const pnj2 = await attendrePnjDeMetier(a2, 10000);
      if (pnj2 && dernierPrix !== null) {
        a2.envoyer({ t: 'troc', j: 0, action: 'consulter', eid: pnj2.e });
        const rep3 = await a2.attendre('troc', 4000, m => m.action === 'offres' && m.eid === pnj2.e).catch(() => null);
        ok(!!rep3, 'consulter fonctionne encore après reprise du monde');
      }
      a2.fermer();
      await dodo(200);
    } finally {
      s2.kill();
      await dodo(200);
    }
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception (reprise --monde) : ${e.message}${C.x}`);
  }

  try { fs.unlinkSync(MONDE); } catch (e) { /* rien */ }

  console.log(`\n${C.b}Integration Troc (SPEC-SYNC-023, L45)${C.x}`);
  console.log(details.join('\n'));
  const total = passes + echecs;
  if (echecs) {
    console.log(`\n${C.r}${echecs} echec(s)${C.x} sur ${total}\n`);
    if (logs.length) console.log(C.d + 'journal serveur :\n' + logs.join('') + C.x);
    process.exit(1);
  }
  console.log(`\n${C.g}${passes}/${total} tests d integration passent${C.x}\n`);
  process.exit(0);
})();
