/* integration-saisons.js — SPEC-SAISON-005 sur un vrai processus server.js :
   le gel et le dégel des eaux dormantes sont décidés par le serveur, à
   l'heure de SON monde, et diffusés aux joueurs proches (BLOC, avec l'état 1
   de la glace de saison) ; la glace survit à l'arrêt et au redémarrage (le
   fichier de monde la porte avec son état) ; on tient debout sur la glace, et
   quand elle fond au printemps on tombe dans l'eau.

   Le monde démarre d'un fichier écrit ici (`--monde`) : une heure juste avant
   l'hiver (pour vérifier que rien ne gèle avant), puis, au redémarrage, une
   heure de printemps. Le lac (graine 20260921) est trouvé avec les mêmes
   modules que le serveur.

   Usage : node tests/integration-saisons.js */
'use strict';
const path = require('path');
const fs = require('fs');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, requete, dossierTemp, supprimerDossier, chargerModules } = A;
const R = A.creerRapport('Intégration SAISONS — gel et dégel des eaux dormantes décidés par le serveur (SPEC-SAISON-005)');
const { ok } = R;

const MC = chargerModules();
const C = MC.Core, B = C.B, DC = MC.DayCycle, NP = A.NP;
const GRAINE = 20260921;
const ANNEE = DC.YEAR_LENGTH, DEBUT_HIVER = ANNEE * 0.75;
const serveurs = [];
async function demarrer(args, env) { const s = await lancer(args, env); serveurs.push(s); return s; }
async function jusqua(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 100);
  }
}
async function sauver(s) {
  for (let k = 0; k < 5; k++) {
    const r = await requete(s.port, '/api/parties/sauver', { corps: {} });
    if (r.code === 429) { await dodo(1100); continue; }
    return r;
  }
  return { code: 0 };
}

/* Un lac froid (gel l'hiver, pas de banquise permanente), sa surface, et une
   berge où poser le joueur. */
function trouverLac() {
  const w = MC.createWorld(GRAINE);
  for (let r = 0; r <= 12000; r += 24) {
    const n = Math.max(1, Math.round(r * 2 * Math.PI / 24));
    for (let k = 0; k < n; k++) {
      const x = Math.round(Math.cos(k / n * 2 * Math.PI) * r), z = Math.round(Math.sin(k / n * 2 * Math.PI) * r);
      const c = w.bio.colonne(x, z);
      if (!(c.climat.lac && c.climat.t < 0.38 && c.climat.t >= 0.26 && c.eau > c.h)) continue;
      const l = w.bio.lacProche(x, z);
      if (!l) continue;
      const cx = l.x, cz = l.z;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) w.getChunk(Math.floor(cx / 16) + a, Math.floor(cz / 16) + b, true);
      let ys = C.WORLD_H - 1; while (ys > 0 && w.getBlock(cx, ys, cz) === 0) ys--;
      if (w.getBlock(cx, ys, cz) !== B.WATER) continue;
      // la berge : vers l'est, la première colonne sèche, deux blocs plus loin
      let bx = cx;
      while (bx < cx + 60 && C.isWater(w.getBlock(bx, ys, cz))) bx++;
      bx += 2;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) w.getChunk(Math.floor(bx / 16) + a, Math.floor(cz / 16) + b, true);
      return { x: cx, z: cz, y: ys, berge: { x: bx + 0.5, y: w.groundAt(bx, cz, true) + 1.2, z: cz + 0.5 }, monde: w };
    }
  }
  return null;
}

function ecrireMonde(f, heure, base) {
  const data = Object.assign({ v: 2, graine: GRAINE, overrides: [], etats: [], crops: [] }, base || {});
  data.heure = heure;
  fs.writeFileSync(f, JSON.stringify(data));
}
// l'heure du serveur au moment où chaque message est arrivé (la dernière ETAT reçue avant lui)
function blocsAvecHeure(cl) {
  let heure = null;
  const out = [];
  cl.messages.forEach(m => {
    if (m.t === NP.MSG.ETAT && typeof m.heure === 'number') heure = m.heure;
    else if (m.t === NP.MSG.BLOC) out.push({ x: m.x, y: m.y, z: m.z, id: m.id, etat: m.etat, heure });
  });
  return out;
}

async function scenario() {
  const lac = trouverLac();
  if (!lac) { R.saut('gel d\'un lac', 'aucun lac froid trouvé pour la graine ' + GRAINE); return; }
  const dossier = dossierTemp('mc-saisons-');
  const f = path.join(dossier, 'monde.json');
  try {
    // ── 1. juste avant l'hiver, au bord du lac ─────────────────────────────
    ecrireMonde(f, DEBUT_HIVER - 8);
    const s1 = await demarrer(['--port', '0', '--graine', String(GRAINE), '--monde', f, '--dossier-parties', dossier],
      { MC_SAUVEGARDE_MS: '600000', MC_TEST_SPAWN: `${lac.berge.x},${lac.berge.y},${lac.berge.z}` });
    const { client: c1 } = await rejoindre(s1.port, 'Hiver', 1);
    const glaceCentre = await jusqua(() => blocsAvecHeure(c1).find(b => b.x === lac.x && b.z === lac.z && b.id === B.ICE), 120000, 200);
    ok(!!glaceCentre, 'SPEC-SAISON-005 : en hiver, le serveur gèle la surface du lac et la diffuse au joueur proche (BLOC glace)',
       'aucun BLOC de glace reçu au centre du lac (' + lac.x + ',' + lac.y + ',' + lac.z + ') en 120 s');
    const glaces = blocsAvecHeure(c1).filter(b => b.id === B.ICE);
    ok(glaces.length > 10, 'SPEC-SAISON-005 : tout le lac se prend en glace, colonne après colonne (' + glaces.length + ' blocs)');
    ok(glaces.every(b => b.etat === 1), 'SPEC-SAISON-005 : chaque glace de saison est diffusée avec son état 1 (elle fondra au printemps)');
    ok(glaces.every(b => b.heure !== null && b.heure >= DEBUT_HIVER - 0.5),
       'SPEC-SAISON-005 : rien ne gèle avant l\'hiver — toutes les glaces arrivent après le début de l\'hiver à l\'heure du serveur',
       JSON.stringify(glaces.filter(b => !(b.heure >= DEBUT_HIVER - 0.5)).slice(0, 3)));
    if (glaceCentre) ok(glaceCentre.y === lac.y, 'SPEC-SAISON-005 : à la surface de l\'eau (y ' + lac.y + ')');
    // déterminisme : le serveur ne gèle que ce que la règle pure dit gelable (mêmes modules, même graine)
    const w = lac.monde;
    const horsRegle = glaces.filter(b => {
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) w.getChunk(Math.floor(b.x / 16) + a, Math.floor(b.z / 16) + c, true);
      const ch = w.getChunk(Math.floor(b.x / 16), Math.floor(b.z / 16));
      const nat = ch.eau.nature[(b.z - ch.cz * 16) * 16 + (b.x - ch.cx * 16)];
      return !(w.getBlock(b.x, b.y, b.z) === B.WATER && w.getBlock(b.x, b.y + 1, b.z) === 0 && w.bio.climat(b.x, b.z).t < 0.38 &&
               MC.Eau.eauDormante(nat, w.getBlock, b.x, b.y, b.z));
    });
    ok(horsRegle.length === 0, 'SPEC-SAISON-005 : chaque case gelée par le serveur est une eau dormante d\'une région froide, d\'après la même règle (MC.Eau.eauDormante) sur le même monde',
       JSON.stringify(horsRegle.slice(0, 3)));
    const r = await sauver(s1);
    ok(r.code === 200, 'préparation : sauvegarde forcée');
    c1.fermer();
    await s1.arreter();
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const ov = (data.overrides || []).find(o => o[0] === lac.x && o[1] === lac.y && o[2] === lac.z);
    const et = (data.etats || []).find(o => o[0] === lac.x && o[1] === lac.y && o[2] === lac.z);
    ok(ov && ov[3] === B.ICE && et && et[3] === 1, 'SPEC-SAISON-005 : le fichier de monde porte la glace de saison ET son état (elle fondra encore après un redémarrage)',
       JSON.stringify({ ov, et }));

    // ── 2. redémarrage au printemps, debout sur la glace au milieu du lac ──
    ecrireMonde(f, ANNEE + 5, data);
    const surGlace = { x: lac.x + 0.5, y: lac.y + 1.02, z: lac.z + 0.5 };
    const s2 = await demarrer(['--port', '0', '--graine', String(GRAINE), '--monde', f, '--dossier-parties', dossier],
      { MC_SAUVEGARDE_MS: '600000', MC_TEST_SPAWN: `${surGlace.x},${surGlace.y},${surGlace.z}` });
    const { client: c2 } = await rejoindre(s2.port, 'Printemps', 1);
    // le joueur reste immobile, mais le serveur n'avance son corps qu'au fil de ses entrées (60 Hz, comme le jeu)
    let seq = 0, der = Date.now();
    const entrees = setInterval(() => {
      const n = Date.now(), dt = Math.min(0.05, (n - der) / 1000); der = n;
      if (dt > 0) c2.envoyer({ t: NP.MSG.ENTREE, s: ++seq, j: 0, dt: +dt.toFixed(4), k: 0, yaw: 0, pitch: 0, v: 0 });
    }, 16);
    const toi = () => { const e = c2.dernier('etat'); return e && e.toi && e.toi[0]; };
    await jusqua(toi, 8000);
    await dodo(1500);
    const debout = toi();
    const encoreGele = !blocsAvecHeure(c2).some(b => b.x === lac.x && b.z === lac.z && b.id === B.WATER);
    if (encoreGele) {
      ok(debout && Math.abs(debout.y - (lac.y + 1)) < 0.1, 'SPEC-SAISON-005 : on tient debout sur la glace (y ' + (debout && debout.y.toFixed(2)) + ', glace en ' + lac.y + ')');
    } else R.saut('debout sur la glace', 'le dégel a atteint le centre du lac avant la première mesure');
    const eau = await jusqua(() => blocsAvecHeure(c2).find(b => b.x === lac.x && b.z === lac.z && b.id === B.WATER), 120000, 200);
    ok(!!eau, 'SPEC-SAISON-005 : au printemps, le serveur fait fondre la glace de saison et le diffuse (BLOC eau)');
    if (eau) {
      ok(eau.heure >= ANNEE - 0.5, 'SPEC-SAISON-005 : le dégel arrive au printemps, à l\'heure du serveur (' + eau.heure + ')');
      ok(eau.etat === 0, 'SPEC-SAISON-005 : l\'eau revenue n\'a plus d\'état');
      await dodo(2500);
      const apres = toi();
      ok(apres && apres.y < lac.y + 0.9, 'SPEC-SAISON-005 : la glace fondue sous lui, le joueur tombe dans l\'eau (y ' + (apres && apres.y.toFixed(2)) + ' sous ' + (lac.y + 1) + ')');
    }
    const regels = blocsAvecHeure(c2).filter(b => b.id === B.ICE);
    ok(regels.length === 0, 'SPEC-SAISON-005 : rien ne gèle au printemps (' + regels.length + ' glace(s) reçue(s))');
    clearInterval(entrees);
    c2.fermer();
    await s2.arreter();
  } finally { supprimerDossier(dossier); }
}

(async () => {
  try {
    await scenario();
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
