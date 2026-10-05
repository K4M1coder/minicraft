/* integration-factions.js — L39 sur de vrais processus server.js : factions PNJ
   et factions de joueurs, le SERVEUR fait foi (solo compris : un serveur local
   fermé au réseau).
   - SPEC-FACTION-007 : une ronde décidée par la simulation politique prend corps
     près des joueurs — des gardes (`garde`, marqués `pa`) apparaissent dans ETAT
     et marchent ; la simulation avance d'un jour côté serveur (POLITIQUE porte le
     nouveau jour) sans qu'aucun client n'y soit pour rien.
   - SPEC-FACTION-006 : l'objectif de la faction change à ce jour-là selon ce qui
     lui arrive (un ordre de son rang n'explore pas), arrive aux clients
     (POLITIQUE, `maj`) et s'annonce dans le chat.
   - SPEC-FACTION-012 : membres d'une faction de joueurs sur la carte — le message
     FACTION_MEMBRES ne part qu'aux membres, avec les seules positions de leurs
     factions (aucune fuite vers un non-membre ni vers une autre faction) ; canal
     de faction réservé aux membres ; diplomatie envers une faction de joueurs et
     envers une faction PNJ (nom en un mot) ; pas de dégâts entre membres, dégâts
     possibles envers un non-membre (zone PvP définie par l'administrateur) ; nom
     de faction balisé refusé ; débit des commandes borné par l'anti-flood.
   - SPEC-FACTION-013 : un administrateur renomme une faction (membres prévenus,
     journalisé), un modérateur en dissout une autre, un joueur ne peut ni l'un
     ni l'autre ; arrêt et relance sur le même fichier de monde : factions,
     membres, rangs, candidature en attente et relations sont rendus ; puis en
     solo (serveur fermé, un seul poste) une action de faction est sauvegardée
     à la pause et retrouvée après relance ; tous les champs du fichier de monde
     sont classés (MC.Save.champsMondeNonClasses).
   Chaque scénario lance ET arrête son serveur (port 0) ; attentes bornées par
   sondage. Usage : node tests/integration-factions.js */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre } = A;
const R = A.creerRapport('Intégration FACTION — factions PNJ et factions de joueurs, serveur arbitre (L39)');
const { ok, eq } = R;

const MC = A.chargerModules();
const serveurs = [];
async function demarrer(args, env) {
  const s = await lancer(['--port', '0'].concat(args || []), env);
  serveurs.push(s);
  return s;
}
async function jusqua(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 50);
  }
}
const etatToi = (cl) => { const e = cl.dernier('etat'); return e && e.toi && e.toi[0]; };
/* L'anti-flood du chat admet 5 messages par 10 s et par connexion
   (serveur-antiflood.js) : chaque client de ce test espace ses commandes. */
async function commande(cl, texte) {
  const t = cl._envois || (cl._envois = []);
  for (;;) {
    const fenetre = t.filter(x => Date.now() - x < 10600);
    if (fenetre.length < 4) break;
    await dodo(200);
  }
  t.push(Date.now());
  cl.envoyer({ t: 'chat', texte });
}
async function reponse(cl, texte, re, ms) {
  const n = cl.messages.length;
  await commande(cl, texte);
  return jusqua(() => cl.messages.slice(n).find(m => m.t === 'chat' && re.test(m.texte || '')), ms || 4000);
}
async function admin(cl, action, args) {
  const n = cl.messages.length;
  cl.envoyer({ t: 'admin', action, args: args || {} });
  return jusqua(() => cl.messages.slice(n).find(m => m.t === 'admin_rep' && m.action === action), 4000);
}
function guildesDe(cl) {
  for (let i = cl.messages.length - 1; i >= 0; i--) if (cl.messages[i].t === 'politique' && cl.messages[i].guildes) return cl.messages[i].guildes;
  return null;
}
function faction(guildes, nom) {
  const e = guildes && (guildes.factions || []).find(x => x[1] && x[1].nom === nom);
  return e ? Object.assign({ id: e[0] }, e[1]) : null;
}

// ── 1. serveur ouvert : rondes, objectifs, membres, canal, diplomatie, modération ──
async function scenarioEnLigne(fichier) {
  const s = await demarrer(['--monde', fichier, '--ouvert', '--admin', 'secretF', '--pvp', 'on', '--zone', 'generee'],
                           { MC_TEST_FACTION_RONDE: '1' });
  const a = await rejoindre(s.port, 'Alice', 1);
  const b = await rejoindre(s.port, 'Bob', 1);
  const c = await rejoindre(s.port, 'Carla', 1);
  const ad = await rejoindre(s.port, 'Admin', 1);
  const auth = await admin(ad.client, 'auth', { secret: 'secretF' });
  ok(auth && auth.ok, 'authentification administrateur');

  // SPEC-FACTION-007 : des gardes en ronde, qui marchent
  const gardes = () => { const e = a.client.dernier('etat'); return e ? (e.mobs || []).filter(m => m.t === 'garde' && m.pa) : []; };
  const vus = await jusqua(() => gardes().length ? gardes() : null, 8000);
  ok(!!vus, 'SPEC-FACTION-007 : la ronde de la faction PNJ prend corps — des gardes en patrouille apparaissent près du joueur', JSON.stringify((a.client.dernier('etat') || {}).mobs || []).slice(0, 300));
  if (vus) {
    const g0 = vus[0], p0 = { x: g0.x, z: g0.z };
    const loin = await jusqua(() => { const g = gardes().find(x => x.e === g0.e); return g && Math.hypot(g.x - p0.x, g.z - p0.z) > 2 ? g : null; }, 10000);
    ok(!!loin, 'SPEC-FACTION-007 : un garde de la ronde se déplace (plus de 2 blocs en 10 s)');
    const spawn = a.bienvenue.toi[0];
    ok(gardes().every(g => Math.hypot(g.x - spawn.x, g.z - spawn.z) < 90), 'SPEC-FACTION-007 : la ronde reste dans le territoire de la faction (autour de son siège)');
  }

  // SPEC-FACTION-006/007 : un jour passe côté serveur — l'objectif évolue, s'annonce et arrive aux clients
  const pol0 = a.client.messages.find(m => m.t === 'politique' && m.pol && m.pol.complet);
  const jour0 = pol0 ? pol0.pol.jour : 0;
  const desc0 = pol0 && (pol0.pol.f || []).find(d => d[0] === 'test:ronde');
  ok(desc0 && desc0[4] === 'explorer' && typeof desc0[5] === 'number', 'SPEC-FACTION-006 : la faction PNJ arrive au join avec son objectif (explorer) et son territoire', JSON.stringify(desc0));
  const indice = pol0 ? (pol0.pol.f || []).findIndex(d => d[0] === 'test:ronde') : -1;
  const n0 = a.client.messages.length;
  const rh = await admin(ad.client, 'heure', { valeur: MC.DayCycle.DAY_LENGTH - 0.5 });
  ok(rh && rh.ok, 'l\'administrateur avance l\'heure à la fin du jour');
  const diff = await jusqua(() => a.client.messages.slice(n0).find(m => m.t === 'politique' && m.pol && !m.pol.complet && m.pol.jour > jour0), 25000, 100);
  ok(!!diff, 'SPEC-FACTION-007 : la simulation politique avance d\'un jour côté serveur (POLITIQUE porte le nouveau jour)', 'jour initial ' + jour0);
  const maj = diff && (diff.pol.maj || []).find(t => t[0] === indice);
  ok(maj && maj[1] !== 'explorer' && ['defendre', 'convertir', 'commercer', 'piller', 'etendre'].indexOf(maj[1]) >= 0,
     'SPEC-FACTION-006 : l\'objectif a évolué selon la situation de la faction (un ordre de ce rang n\'explore pas) et la différence le transmet', JSON.stringify(diff && diff.pol.maj));
  const annonce = await jusqua(() => a.client.messages.slice(n0).find(m => m.t === 'chat' && /Garde du Col change d'objectif/.test(m.texte || '')), 4000);
  ok(!!annonce, 'SPEC-FACTION-006 : le changement d\'objectif s\'annonce dans le chat');

  // SPEC-FACTION-012 : une faction de joueurs, ses membres sur la carte, rien pour les autres
  ok(!!(await reponse(a.client, '/faction creer <b>Loups</b>', /nom invalide/)), 'SPEC-FACTION-012 (sécurité) : un nom balisé est refusé');
  ok(!!(await reponse(a.client, '/faction creer Loups #c03030', /fondée/)), 'SPEC-FACTION-009 : Alice fonde « Loups »');
  ok(!!(await reponse(b.client, '/faction postuler Loups', /Candidature envoyée/)), 'Bob postule');
  ok(!!(await reponse(a.client, '/faction accepter Loups Bob', /Bob rejoint/)), 'Alice accepte Bob');
  ok(!!(await reponse(c.client, '/faction creer Ours', /fondée/)), 'Carla fonde « Ours »');
  const membresAlice = await jusqua(() => { const m = a.client.dernier('faction_membres'); return m && m.l.some(e => e[0] === 'Bob') ? m : null; }, 5000);
  ok(!!membresAlice, 'SPEC-FACTION-012 : Alice reçoit la position de Bob, membre de sa faction');
  if (membresAlice) {
    const eb = membresAlice.l.find(e => e[0] === 'Bob'), tb = etatToi(b.client);
    ok(tb && Math.hypot(eb[1] - tb.x, eb[2] - tb.z) < 3, 'SPEC-FACTION-012 : la position annoncée est celle de Bob', JSON.stringify(eb) + ' / ' + JSON.stringify(tb));
    ok(membresAlice.l.every(e => e[0] !== 'Alice' && e[0] !== 'Carla' && e[0] !== 'Admin'), 'SPEC-FACTION-012 : ni soi-même ni un non-membre dans la liste');
    ok(membresAlice.l.every(e => e[3] === faction(guildesDe(a.client), 'Loups').id), 'SPEC-FACTION-012 : seulement la faction d\'Alice');
  }
  ok(!!(await jusqua(() => { const m = b.client.dernier('faction_membres'); return m && m.l.some(e => e[0] === 'Alice'); }, 5000)), 'SPEC-FACTION-012 : Bob voit Alice');
  await dodo(1500);
  const fuiteCarla = c.client.messages.filter(m => m.t === 'faction_membres').some(m => m.l.some(e => e[0] === 'Alice' || e[0] === 'Bob'));
  ok(!fuiteCarla, 'SPEC-FACTION-012 : Carla (autre faction) ne reçoit jamais la position d\'un membre de « Loups »');
  ok(!ad.client.messages.some(m => m.t === 'faction_membres' && m.l.length), 'SPEC-FACTION-012 : un joueur sans faction ne reçoit aucune position');

  // canal de faction
  const nCanal = c.client.messages.length;
  await commande(b.client, '/faction dire rendez-vous au col');
  const canal = await jusqua(() => a.client.messages.find(m => m.t === 'chat' && m.type === 'faction' && /rendez-vous au col/.test(m.texte)), 4000);
  ok(canal && /^\[Loups\] Bob : /.test(canal.texte), 'SPEC-FACTION-012 : le canal de faction porte le message aux membres', canal && canal.texte);
  await dodo(400);
  ok(!c.client.messages.slice(nCanal).some(m => m.t === 'chat' && m.type === 'faction'), 'SPEC-FACTION-012 : un non-membre ne lit pas le canal');

  // diplomatie : envers une faction de joueurs, envers une faction PNJ (nom en un mot)
  ok(!!(await reponse(a.client, '/faction relation Loups Ours ennemie', /se déclare ennemie/)), 'SPEC-FACTION-012 : Loups se déclare ennemie d\'Ours');
  ok(!!(await reponse(a.client, '/faction relation Loups Garde_du_Col alliee', /se déclare alliee/)), 'SPEC-FACTION-012 : Loups se déclare alliée d\'une faction PNJ, désignée par son nom');
  ok(!!(await reponse(b.client, '/faction relation Loups Ours alliee', /pas le droit/)), 'SPEC-FACTION-012 : une recrue ne déclare pas la diplomatie');
  const gu = await jusqua(() => { const g = guildesDe(c.client), f = faction(g, 'Loups'); return f && f.relations.length >= 2 ? f : null; }, 4000);
  const ours = faction(guildesDe(c.client), 'Ours');
  ok(gu && ours && gu.relations.some(r => r[0] === ours.id && r[1] === 'ennemie') && gu.relations.some(r => r[0] === 'test:ronde' && r[1] === 'alliee'),
     'SPEC-FACTION-012 : les relations déclarées sont diffusées (POLITIQUE, guildes)', JSON.stringify(gu && gu.relations));
  const ext = await jusqua(() => a.client.messages.slice().reverse().find(m => m.t === 'politique' && m.pol && (m.pol.ext || []).some(t => /test:ronde/.test(t[0]) && t[1] === 'alliance')), 4000);
  ok(!!ext, 'SPEC-FACTION-012 : la relation est réciproque côté PNJ (alliance perçue dans les deux sens)');

  // pas de dégâts entre membres ; un non-membre peut être blessé (zone PvP définie par l'administrateur)
  const sp = a.bienvenue.toi[0];
  const rz = await admin(ad.client, 'zone_definir', { x: Math.floor(sp.x), z: Math.floor(sp.z), zone: 'pvp' });
  ok(rz && rz.ok && rz.data && rz.data.ok, 'zone PvP définie au point d\'apparition');
  await dodo(400);
  const pv = (cl) => (etatToi(cl) || {}).pv;
  const pvBob = pv(b.client);
  a.client.envoyer({ t: 'attaque', j: 0, degats: 5, joueurCible: b.bienvenue.id + '/0' });
  await dodo(800);
  eq(pv(b.client), pvBob, 'SPEC-FACTION-012 : deux membres d\'une même faction ne se blessent pas');
  const pvCarla = pv(c.client);
  a.client.envoyer({ t: 'attaque', j: 0, degats: 5, joueurCible: c.bienvenue.id + '/0' });
  ok(!!(await jusqua(() => pv(c.client) < pvCarla, 3000)), 'SPEC-FACTION-012 (témoin) : la même attaque blesse un non-membre', 'pv ' + pvCarla + ' → ' + pv(c.client));
  await admin(ad.client, 'zone_retirer', { x: Math.floor(sp.x), z: Math.floor(sp.z) });

  // anti-flood : une rafale de commandes n'est pas toute traitée
  const nFlood = c.client.messages.length;
  for (let i = 0; i < 12; i++) c.client.envoyer({ t: 'chat', texte: '/faction info' });
  await dodo(1200);
  const repFlood = c.client.messages.slice(nFlood).filter(m => m.t === 'chat' && /Principale/.test(m.texte || '')).length;
  ok(repFlood > 0 && repFlood < 12, 'SPEC-FACTION-012 (sécurité) : une rafale de /faction est bornée par l\'anti-flood du chat', repFlood + ' réponses sur 12');
  await dodo(10500);       // fenêtre de l'anti-flood écoulée

  // SPEC-FACTION-013 : modération — un joueur ne peut pas, l'administrateur renomme, un modérateur dissout
  const refus = await admin(b.client, 'faction_gerer', { op: 'renommer', faction: 'Loups', nom: 'Pirates' });
  ok(refus && !refus.ok, 'SPEC-FACTION-013 : un simple joueur ne renomme pas une faction');
  const liste = await admin(ad.client, 'faction_gerer', { op: 'lister' });
  ok(liste && liste.ok && liste.data.some(f => f.nom === 'Loups' && f.chef === 'Alice' && f.membres === 2), 'SPEC-FACTION-013 : l\'administrateur liste les factions (chef, membres)', JSON.stringify(liste && liste.data));
  const nAvis = b.client.messages.length;
  const ren = await admin(ad.client, 'faction_gerer', { op: 'renommer', faction: 'Loups', nom: 'Meute' });
  ok(ren && ren.ok, 'SPEC-FACTION-013 : l\'administrateur renomme « Loups » en « Meute »', JSON.stringify(ren));
  ok(!!(await jusqua(() => b.client.messages.slice(nAvis).find(m => m.t === 'chat' && /renommée « Meute »/.test(m.texte || '')), 3000)), 'SPEC-FACTION-013 : les membres sont prévenus');
  ok(!!(await jusqua(() => faction(guildesDe(c.client), 'Meute'), 3000)), 'SPEC-FACTION-013 : le nouveau nom est diffusé à tous (POLITIQUE)');
  const malveillant = await admin(ad.client, 'faction_gerer', { op: 'renommer', faction: 'Meute', nom: 'X\nINFO faux' });
  ok(malveillant && !malveillant.ok, 'SPEC-FACTION-013 (sécurité) : un nom à saut de ligne est refusé, même pour l\'administrateur');
  // la console web d'administration passe par l'API HTTP (même cœur, même droits)
  const bearer = { Authorization: 'Bearer secretF' };
  const hl = await A.requete(s.port, '/admin/api/faction_gerer?op=lister', { entetes: bearer });
  ok(hl.code === 200 && hl.json && hl.json.data.some(f => f.nom === 'Meute'), 'SPEC-FACTION-013 : la console web liste les factions (GET /admin/api/faction_gerer)', hl.corps.slice(0, 200));
  const hsans = await A.requete(s.port, '/admin/api/faction_gerer?op=lister');
  eq(hsans.code, 401, 'SPEC-FACTION-013 : sans jeton, la console est refusée');
  const hr = await A.requete(s.port, '/admin/api/faction_gerer', { entetes: bearer, corps: { op: 'renommer', faction: 'Ours', nom: 'Ourses' } });
  ok(hr.code === 200 && hr.json.ok, 'SPEC-FACTION-013 : la console web renomme une faction (POST)', hr.corps.slice(0, 200));
  ok(!!(await jusqua(() => faction(guildesDe(c.client), 'Ourses'), 3000)), 'SPEC-FACTION-013 : renommée depuis la console, la faction est diffusée sous son nouveau nom');
  const nomme = await admin(ad.client, 'role_nommer', { nom: 'Dan', role: 'moderateur' });
  const jetonMod = nomme && nomme.data && nomme.data.jeton;
  ok(!!jetonMod, 'un modérateur est nommé');
  const d = await rejoindre(s.port, 'Dan', 1);
  const authMod = await admin(d.client, 'auth', { secret: jetonMod });
  ok(authMod && authMod.ok && authMod.data.role === 'moderateur', 'le modérateur s\'authentifie');
  const diss = await admin(d.client, 'faction_gerer', { op: 'dissoudre', faction: 'Ourses' });
  ok(diss && diss.ok, 'SPEC-FACTION-013 : un modérateur dissout « Ourses »', JSON.stringify(diss));
  ok(!!(await jusqua(() => { const g = guildesDe(a.client); return g && !faction(g, 'Ourses') && faction(g, 'Meute'); }, 3000)), 'SPEC-FACTION-013 : la dissolution est diffusée');
  const journal = await admin(ad.client, 'journal', { limite: 50 });
  ok(journal && journal.ok && journal.data.some(e => e.action === 'faction_renommer' && /Loups → Meute/.test(e.details || '')) && journal.data.some(e => e.action === 'faction_dissoudre'),
     'SPEC-FACTION-013 : renommage et dissolution sont journalisés');

  // une candidature en attente, avant l'arrêt
  ok(!!(await reponse(d.client, '/faction postuler Meute', /Candidature envoyée/)), 'Dan postule à « Meute » (candidature en attente)');
  ok(!!(await reponse(a.client, '/faction promouvoir Meute Bob', /promu/)), 'Bob est promu membre');
  [a, b, c, d, ad].forEach(x => x.client.fermer());
  await dodo(300);
  await s.arreter();
}

// ── 2. relance sur le même monde : tout est rendu ─────────────────────────────
async function scenarioRelance(fichier) {
  const data = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  ok(data.guildes && (data.guildes.factions || []).some(e => e[1].nom === 'Meute'), 'SPEC-FACTION-013 : les factions de joueurs sont dans le fichier de monde');
  ok(data.politique && (data.politique.factions || []).length > 0, 'SPEC-FACTION-013 : l\'état politique aussi');
  const manquants = MC.Save.champsMondeNonClasses(data);
  eq(manquants.length, 0, 'SPEC-FACTION-013 : chaque champ du fichier de monde est classé (MC.Save.CHAMPS_IDS_MONDE)');
  const s = await demarrer(['--monde', fichier, '--ouvert']);
  const a = await rejoindre(s.port, 'Alice', 1);
  const g = await jusqua(() => guildesDe(a.client), 5000);
  const meute = faction(g, 'Meute');
  ok(meute && meute.membres.some(m => m[0] === 'Alice' && m[1] === 'chef') && meute.membres.some(m => m[0] === 'Bob' && m[1] === 'membre'),
     'SPEC-FACTION-013 : après relance, la faction, ses membres et leurs rangs sont rendus', JSON.stringify(meute));
  ok(meute && meute.relations.some(r => r[0] === 'test:ronde' && r[1] === 'alliee'), 'SPEC-FACTION-013 : ses relations aussi');
  ok(!faction(g, 'Ours') && !faction(g, 'Ourses'), 'SPEC-FACTION-013 : la faction dissoute le reste');
  ok(!!(await reponse(a.client, '/faction accepter Meute Dan', /Dan rejoint/)), 'SPEC-FACTION-013 : la candidature en attente a survécu à la relance');
  a.client.fermer();
  await dodo(300);
  await s.arreter();
}

// ── 3. solo (serveur fermé au réseau) : sauvegarde hors ligne du joueur local ──
async function scenarioSolo(fichier) {
  const s = await demarrer(['--monde', fichier]);
  const a = await rejoindre(s.port, 'Alice', 1);
  ok(!!(await reponse(a.client, '/faction creer Solitaires', /fondée/)), 'SPEC-FACTION-013 : en solo, Alice fonde une seconde faction');
  ok(!!(await reponse(a.client, '/faction principale Solitaires', /principale/)), 'elle en fait sa faction principale');
  const mtime = fs.statSync(fichier).mtimeMs;
  a.client.envoyer({ t: 'pause', actif: true });
  ok(!!(await jusqua(() => fs.statSync(fichier).mtimeMs > mtime, 3000)), 'SPEC-FACTION-013 : la pause du joueur local sauvegarde le monde aussitôt');
  a.client.fermer();
  await dodo(300);
  await s.arreter();
  const s2 = await demarrer(['--monde', fichier]);
  const a2 = await rejoindre(s2.port, 'Alice', 1);
  const g = await jusqua(() => guildesDe(a2.client), 5000);
  const sol = faction(g, 'Solitaires');
  ok(sol && g.joueurs.some(j => j[0] === 'Alice' && j[1].principale === sol.id && j[1].secondaires.indexOf(faction(g, 'Meute').id) >= 0),
     'SPEC-FACTION-013 : relancée, la partie solo rend la nouvelle faction principale et l\'ancienne en secondaire', JSON.stringify(g && g.joueurs));
  a2.client.fermer();
  await dodo(300);
  await s2.arreter();
}

(async () => {
  const dossier = A.dossierTemp('mc-factions-');
  const fichier = path.join(dossier, 'monde.json');
  try {
    await scenarioEnLigne(fichier);
    await scenarioRelance(fichier);
    await scenarioSolo(fichier);
  } catch (e) {
    ok(false, 'exception : ' + (e && e.stack || e), serveurs.map(s => s.logs.slice(-25).join('\n')).join('\n----\n'));
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
    A.supprimerDossier(dossier);
  }
  process.exit(R.fin());
})();
