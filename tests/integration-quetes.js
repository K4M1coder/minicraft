/* integration-quetes.js — la part réseau de SPEC-QUETE-004 : le serveur reste
   seul arbitre du tableau de quêtes actives par joueur (src/serveur-joueurs.js:traiterQuete,
   MC.Politique.accepterQuete/remettreQuete). Vraies sockets, vrai serveur,
   comme integration-pvp.js.

   Le déterminisme des QUÊTES DE FACTION elles-mêmes (naissance, proposition,
   récompense) est déjà couvert, pur et déterministe, par tests/spec-politique.js
   (describe « L46 ») — reproduire ici une vraie faction née d'une ville
   explorée serait fragile (dépend d'un lieu politique réel à une position
   connue à l'avance dans un monde généré, comme le note déjà l'en-tête
   d'integration-pvp.js pour SPEC-PVP-003/006). Ce script vérifie donc
   seulement ce qu'un test pur ne peut pas : le CHEMIN RÉSEAU réel (chat →
   src/serveur-joueurs.js:traiterQuete → MC.Politique) répond bien, sans planter, et
   qu'une remise sans quête active échoue proprement (arbitrage serveur,
   jamais un client) — la non-duplication de la récompense elle-même est
   prouvée par spec-politique.js sur les MÊMES fonctions que celles que
   traiterQuete appelle.

   Usage : node tests/integration-quetes.js [port] */
'use strict';
const FORMAT_IDS = require('./format-ids.js').FIRST_ITEM;   // SPEC-SAVE-025 : annoncé par REJOINDRE
require('./journal-temp.js');   // journal des serveurs lancés : dossier temporaire (SPEC-BANC-106)
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8219;

const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, isNaN, isFinite, parseInt, parseFloat,
}));
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(RACINE, 'src/net-protocol.js'), 'utf8'), ctx);
const NP = ctx.MC.NetProtocol;
// src/core.js décale les id d'objets (I.EMERALD, I.GOLD_INGOT…) d'une
// constante interne : on les relit ICI plutôt que de recopier un nombre en
// dur, qui se déréglerait au moindre bloc/objet ajouté au jeu.
vm.runInContext(fs.readFileSync(path.join(RACINE, 'src/core.js'), 'utf8'), ctx);
const CoreI = ctx.MC.Core.I;

const C = { r: '\x1b[31m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let passes = 0, echecs = 0;
const details = [];
function ok(cond, nom, info) {
  if (cond) { passes++; details.push(`  ${C.g}·${C.x} ${C.d}${nom}${C.x}`); }
  else { echecs++; details.push(`  ${C.r}✗ ${nom}${C.x}${info ? '\n    ' + C.r + info + C.x : ''}`); }
}
function eq(a, b, nom) { ok(a === b, nom, `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }

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
/* Envoie une commande de chat en respectant le budget anti-flood du serveur
   (5 messages/10 s, server.js FLOOD_CHAT_MAX) : une pause de 2,2 s AVANT
   l'envoi (sauf le tout premier message d'une connexion) suffit à rester
   toujours sous la limite. Renvoie la réponse qui satisfait `predicat`. */
async function chat(client, texte, predicat, ms) {
  await dodo(2200);
  client.envoyer({ t: 'chat', texte });
  return client.attendre('chat', ms || 4000, predicat);
}
async function attendreDemarrage(port) {
  for (let essai = 0; essai < 60; essai++) {
    await dodo(100);
    const sonde = await requete(port, '/index.html');
    if (sonde.code === 200) return true;
  }
  return false;
}

const ITEM_EMERALD = CoreI.EMERALD;
function totalItem(inv, id) { return (inv || []).reduce((s2, c) => s2 + (c && c[0] === id ? c[1] : 0), 0); }
// SPEC-SECU-005/006 : le chat est limité à 5 messages/10 s (server.js
// FLOOD_CHAT_MAX/FLOOD_CHAT_FENETRE_MS) — au-delà, un message est
// SILENCIEUSEMENT ignoré (jamais une erreur). Un script qui enchaînerait les
// /quete sans respecter ce budget verrait ses commandes disparaître sans
// explication ; `chat()` espace donc chaque envoi de 2,2 s pour rester
// toujours sous la limite, comme le ferait un vrai joueur qui tape.

(async function () {
  const logs = [];
  // MC_TEST_QUETE=1 : voir server.js — injecte une faction déterministe
  // (objectif 'commercer', ressources sous le seuil bas) pour que ce script
  // exerce le VRAI chemin serveur (traiterQuete → MC.Politique →
  // inventaire réel), sans dépendre d'une ville explorée procéduralement.
  const s = spawn(process.execPath, [path.join(RACINE, 'server.js'), '--port', String(PORT), '--admin', 'secretQuetes', '--ouvert'],
                   { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { MC_TEST_QUETE: '1' }) });
  s.stdout.on('data', d => logs.push(String(d)));
  s.stderr.on('data', d => logs.push('ERR ' + String(d)));
  let a;
  try {
    ok(await attendreDemarrage(PORT), 'le serveur démarre');

    a = await connecter(PORT);
    a.envoyer({ t: 'rejoindre', formatIds: FORMAT_IDS, nom: 'Alice', locaux: 1 });
    await a.attendre('bienvenue');

    // /quete lister ne plante jamais, même sans quête proposée
    const rep0 = await chat(a, '/quete lister', m => m.type === 'systeme');
    ok(!!rep0, 'SPEC-QUETE-004 : /quete lister répond (chemin réseau chat → traiterQuete → MC.Politique)', rep0 && rep0.texte);

    // accepter une quête inconnue échoue proprement, sans planter le serveur
    const repAcc = await chat(a, '/quete accepter introuvable:0', m => /introuvable/.test(m.texte || ''));
    ok(!!repAcc, 'SPEC-QUETE-004 : accepter une quête inconnue échoue proprement (arbitrage serveur)', repAcc && repAcc.texte);

    // remettre une quête jamais acceptée échoue — le serveur seul arbitre,
    // jamais un client qui prétendrait l'avoir déjà en cours
    const repRem1 = await chat(a, '/quete remettre jamais-acceptee', m => /[Rr]ien à remettre/.test(m.texte || ''));
    ok(!!repRem1, 'SPEC-QUETE-004 : remettre sans quête active échoue (« introuvable » côté arbitrage)', repRem1 && repRem1.texte);

    // une double tentative de remise (même id, deux messages successifs)
    // échoue les DEUX fois faute d'acceptation préalable — le serveur ne se
    // laisse jamais abuser par la seule RÉPÉTITION d'une demande.
    const repRem2 = await chat(a, '/quete remettre jamais-acceptee', m => /[Rr]ien à remettre/.test(m.texte || '') && m !== repRem1);
    ok(!!repRem2, 'SPEC-QUETE-004 : une répétition ne fait jamais réussir une remise arbitrée refusée', repRem2 && repRem2.texte);

    // ── la VRAIE quête injectée par MC_TEST_QUETE (livraison de 'or', voir
    // server.js) : accepter, puis une remise PRÉMATURÉE (sans avoir livré la
    // ressource — Alice n'a aucun émeraude) doit être REFUSÉE, sans créditer
    // aucune récompense (SPEC-QUETE-002/005, défaut « aucune vérification »). ──
    const propose = await chat(a, '/quete lister', m2 => /Proposée/.test(m2.texte || '') && /test:quete-e2e/.test(m2.texte || ''));
    ok(!!propose, 'SPEC-QUETE-004 : la faction de test injectée (MC_TEST_QUETE) propose réellement une quête de livraison', propose && propose.texte);
    const idQuete = propose && (propose.texte.match(/\[([^\]]+)\]/) || [])[1];
    ok(!!idQuete, 'un identifiant de quête est extrait du message', propose && propose.texte);

    const repAccepte = await chat(a, '/quete accepter ' + idQuete, m => /^Quête (acceptée|déjà acceptée)/.test(m.texte || ''));
    ok(!!repAccepte && /^Quête acceptée/.test(repAccepte.texte), 'SPEC-QUETE-004 : la quête RÉELLE est acceptée (pas « déjà acceptée » : une vraie première acceptation)', repAccepte && repAccepte.texte);

    const avantInv = (a.messages.filter(m => m.t === 'inv_maj').pop() || {}).inv;
    const emeraudesAvant = totalItem(avantInv, ITEM_EMERALD);
    eq(emeraudesAvant, 0, 'Alice n\'a encore aucun émeraude : rien n\'a été livré');

    const refusPremature = await chat(a, '/quete remettre ' + idQuete, m => /Objectif non atteint/.test(m.texte || ''));
    ok(!!refusPremature, 'SPEC-QUETE-002/005 : une remise PRÉMATURÉE (rien livré) est refusée par le serveur', refusPremature && refusPremature.texte);
    ok(/ressource_manquante/.test(refusPremature.texte || ''), 'le motif du refus est bien « ressource manquante »', refusPremature.texte);
    const invApresRefus = (a.messages.filter(m => m.t === 'inv_maj').pop() || {}).inv;
    eq(totalItem(invApresRefus, ITEM_EMERALD), 0, 'aucun émeraude créditicé après un refus : la récompense n\'est JAMAIS versée sans objectif atteint');
    const enCoursApresRefus = await chat(a, '/quete lister', m => /En cours/.test(m.texte || ''));
    ok(/active/.test(enCoursApresRefus.texte || ''), 'SPEC-QUETE-004 : la quête reste active après un refus (pas marquée remise)', enCoursApresRefus.texte);

    a.fermer();
    await dodo(150);
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception (partie 1, remise prématurée) : ${e.message}${C.x}`);
    if (process.env.MC_DEBUG_QUETES) console.log('DEBUG a.messages =', JSON.stringify(a && a.messages, null, 1));
  } finally {
    s.kill();
    await dodo(200);
  }

  // ── partie 2 : un joueur qui possède RÉELLEMENT de quoi livrer voit sa
  // remise réussir, ET son inventaire créditer la récompense réelle
  // (SPEC-QUETE-004/005, défaut « aucune récompense créditée »). ──────────
  const PORT2 = PORT + 1;
  const logs2 = [];
  const ITEM_GOLD_INGOT = CoreI.GOLD_INGOT;   // la ressource RÉELLEMENT livrée pour 'or' (jamais l'émeraude elle-même)
  const s2 = spawn(process.execPath, [path.join(RACINE, 'server.js'), '--port', String(PORT2), '--admin', 'secretQuetes2', '--ouvert'],
                    { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'],
                      env: Object.assign({}, process.env, { MC_TEST_QUETE: '1', MC_TEST_INV: JSON.stringify([[ITEM_GOLD_INGOT, 25]]) }) });
  s2.stdout.on('data', d => logs2.push(String(d)));
  s2.stderr.on('data', d => logs2.push('ERR ' + String(d)));
  let b;
  try {
    ok(await attendreDemarrage(PORT2), 'le second serveur (MC_TEST_INV=25 émeraudes) démarre');
    b = await connecter(PORT2);
    b.envoyer({ t: 'rejoindre', formatIds: FORMAT_IDS, nom: 'Bob', locaux: 1 });
    await b.attendre('bienvenue');

    const proposeB = await chat(b, '/quete lister', m => /Proposée/.test(m.texte || '') && /test:quete-e2e/.test(m.texte || ''));
    const idQueteB = proposeB && (proposeB.texte.match(/\[([^\]]+)\]/) || [])[1];
    ok(!!idQueteB, 'SPEC-QUETE-004 : la quête de livraison est de nouveau proposée à Bob', proposeB && proposeB.texte);

    const repAccepteB = await chat(b, '/quete accepter ' + idQueteB, m => /^Quête (acceptée|déjà acceptée)/.test(m.texte || ''));
    ok(!!repAccepteB && /^Quête acceptée/.test(repAccepteB.texte), 'Bob accepte réellement la quête', repAccepteB && repAccepteB.texte);

    const invAvant = (b.messages.filter(m => m.t === 'inv_maj').pop() || {}).inv;
    const lingotsAvant = totalItem(invAvant, ITEM_GOLD_INGOT);
    const emeraudesAvantB = totalItem(invAvant, ITEM_EMERALD);
    eq(lingotsAvant, 25, 'Bob possède bien les 25 lingots d\'or seedés (MC_TEST_INV)');
    eq(emeraudesAvantB, 0, 'Bob ne possède encore aucun émeraude (pas de récompense avant remise)');

    const remiseOk = await chat(b, '/quete remettre ' + idQueteB, m => /Quête remise/.test(m.texte || ''));
    ok(!!remiseOk, 'SPEC-QUETE-002/004 : la remise réussit RÉELLEMENT quand la ressource livrée est bien présente', remiseOk && remiseOk.texte);
    const recompenseAnnoncee = parseFloat((remiseOk.texte.match(/récompense ([\d.]+)/) || [])[1]);
    ok(recompenseAnnoncee > 0, 'une récompense réelle (positive) est annoncée', remiseOk.texte);

    await dodo(200);
    const invApres = (b.messages.filter(m => m.t === 'inv_maj').pop() || {}).inv;
    const lingotsApres = totalItem(invApres, ITEM_GOLD_INGOT);
    const emeraudesApres = totalItem(invApres, ITEM_EMERALD);
    // SPEC-QUETE-002 : les 10 lingots livrés sont RÉELLEMENT consommés.
    eq(lingotsApres, lingotsAvant - 10, 'SPEC-QUETE-002 : les 10 lingots livrés sont réellement retirés de l\'inventaire de Bob');
    // SPEC-QUETE-004/005 (défaut « aucune récompense versée ») : l'inventaire
    // grandit RÉELLEMENT, en émeraudes, du montant annoncé — jamais seulement le chat.
    ok(emeraudesApres > emeraudesAvantB, 'SPEC-QUETE-004 : l\'inventaire de Bob a RÉELLEMENT grandi (émeraudes créditées, pas seulement le chat)',
       `avant=${emeraudesAvantB} après=${emeraudesApres}`);
    eq(emeraudesApres, Math.round(recompenseAnnoncee),
       'le crédit réel en émeraudes correspond exactement à la récompense annoncée (aucune duplication, aucune perte)');

    // une seconde remise de la MÊME quête échoue : jamais deux fois la récompense
    const remiseDouble = await chat(b, '/quete remettre ' + idQueteB, m => /[Rr]ien à remettre/.test(m.texte || ''));
    ok(!!remiseDouble, 'SPEC-QUETE-004 : une seconde remise de la même quête est refusée (jamais deux fois la récompense)', remiseDouble && remiseDouble.texte);
    await dodo(150);
    const invFinal = (b.messages.filter(m => m.t === 'inv_maj').pop() || {}).inv;
    eq(totalItem(invFinal, ITEM_EMERALD), emeraudesApres, 'aucun crédit supplémentaire après la seconde tentative refusée');
    eq(totalItem(invFinal, ITEM_GOLD_INGOT), lingotsApres, 'aucun lingot supplémentaire consommé après la seconde tentative refusée');

    b.fermer();
    await dodo(150);
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception (partie 2, remise valide + récompense) : ${e.message}${C.x}`);
    if (process.env.MC_DEBUG_QUETES) console.log('DEBUG b.messages =', JSON.stringify(b && b.messages, null, 1));
  } finally {
    s2.kill();
    await dodo(200);
  }

  // ── partie 3 : une VRAIE catastrophe météo (src/serveur-simulation.js:avancerCatastrophes,
  // avec MC_TEST_CATASTROPHE — un lieu et une tornade réellement branchés
  // dans monde.meteo/monde.habitats, jamais un appel isolé) endommage
  // réellement un lieu et propose réellement une quête de secours
  // (SPEC-ENV-001/004, SPEC-QUETE-003) — défaut « rien n'est câblé dans la
  // boucle de jeu réelle ». ─────────────────────────────────────────────────
  const PORT3 = PORT + 2;
  const logs3 = [];
  const s3 = spawn(process.execPath, [path.join(RACINE, 'server.js'), '--port', String(PORT3), '--admin', 'secretQuetes3', '--ouvert'],
                    { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'],
                      env: Object.assign({}, process.env, { MC_TEST_CATASTROPHE: '1' }) });
  s3.stdout.on('data', d => logs3.push(String(d)));
  s3.stderr.on('data', d => logs3.push('ERR ' + String(d)));
  let d3;
  try {
    ok(await attendreDemarrage(PORT3), 'le troisième serveur (MC_TEST_CATASTROPHE) démarre');
    d3 = await connecter(PORT3);
    d3.envoyer({ t: 'rejoindre', formatIds: FORMAT_IDS, nom: 'Diane', locaux: 1 });
    await d3.attendre('bienvenue');

    // avancerCatastrophes tourne toutes les ~1 s (voir la boucle de jeu,
    // server.js) : la tornade injectée y est déjà active dès le départ.
    const annonce = await d3.attendre('chat', 8000, m => /frappé par une tornade/.test(m.texte || ''));
    ok(!!annonce, 'SPEC-ENV-001/QUETE-003 : la VRAIE boucle serveur détecte la tornade et endommage réellement le lieu (annonce en chat)', annonce && annonce.texte);
    ok(/Bourg de test/.test(annonce.texte || ''), 'l\'annonce désigne le vrai lieu synthétique touché', annonce && annonce.texte);

    const listeCata = await chat(d3, '/quete lister', m => /Proposée/.test(m.texte || '') && /test:lieu-catastrophe/.test(m.texte || ''));
    ok(!!listeCata, 'SPEC-QUETE-003 : la quête de reconstruction/secours EST RÉELLEMENT proposée via /quete lister (pas seulement calculée en isolation)', listeCata && listeCata.texte);

    d3.fermer();
    await dodo(150);
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception (partie 3, catastrophe réelle) : ${e.message}${C.x}`);
    if (process.env.MC_DEBUG_QUETES) console.log('DEBUG d3.messages =', JSON.stringify(d3 && d3.messages, null, 1));
  } finally {
    s3.kill();
    await dodo(200);
  }

  console.log(`\n${C.b}Integration quêtes (SPEC-QUETE-004, arbitrage serveur)${C.x}`);
  console.log(details.join('\n'));
  const total = passes + echecs;
  if (echecs) {
    console.log(`\n${C.r}${echecs} echec(s)${C.x} sur ${total}\n`);
    if (logs.length) console.log(C.d + 'journal serveur 1 :\n' + logs.join('') + C.x);
    if (logs2.length) console.log(C.d + 'journal serveur 2 :\n' + logs2.join('') + C.x);
    if (logs3.length) console.log(C.d + 'journal serveur 3 :\n' + logs3.join('') + C.x);
    process.exit(1);
  }
  console.log(`\n${C.g}${passes}/${total} tests d integration passent${C.x}\n`);
  process.exit(0);
})();
