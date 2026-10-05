/* serveur-parties.js — les parties sur disque
   Adaptateur de FICHIERS du stockage de MC.Saves (SPEC-ARCHI-013) :
   l'index dans `index.json`, chaque partie dans `<id>.json`.

   Module du serveur (SPEC-SERVEUR-008) : extrait de server.js sans changement
   de comportement. Il ne touche ni socket ni fichier par lui-même : tout ce
   dont il dépend arrive par le contexte S (état partagé, fonctions des autres
   modules) et S.hote (minuteries, process, Buffer… de Node), que server.js
   construit puis passe à `installer(S)`. Installer publie dans S les
   fonctions et valeurs de ce module dont les autres ont besoin. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function installer(S) {
    const { fs, path, DOSSIER_PARTIES } = S;
    Object.assign(S, { fichierMonde });

    /* SPEC-ARCHI-013 : MC.Saves (module pur) gère l'index et les fiches de partie ;
       son stockage injecté est ici un adaptateur de FICHIERS — l'index dans
       `index.json`, chaque partie dans `<id>.json` (le format de --monde). */
    function fichierStockage(cle) {
      if (cle === MC.Saves.INDEX_KEY) return path.join(DOSSIER_PARTIES, 'index.json');
      if (typeof cle === 'string' && cle.indexOf(MC.Saves.SLOT_PREFIX) === 0) {
        const id = cle.slice(MC.Saves.SLOT_PREFIX.length);
        return MC.PartiesFichier.idValide(id) ? path.join(DOSSIER_PARTIES, id + '.json') : null;
      }
      return null;
    }
    const stockageParties = {
      getItem(cle) {
        const f = fichierStockage(cle);
        if (!f) return null;
        try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; }
      },
      setItem(cle, valeur) {
        const f = fichierStockage(cle);
        if (!f) throw new Error('clé de stockage refusée');
        fs.mkdirSync(DOSSIER_PARTIES, { recursive: true });
        fs.writeFileSync(f + '.tmp', valeur);
        try { fs.renameSync(f + '.tmp', f); }
        catch (e) { try { fs.unlinkSync(f + '.tmp'); } catch (e2) { /* rien */ } throw e; }
      },
      removeItem(cle) {
        const f = fichierStockage(cle);
        if (!f) return;
        try { fs.unlinkSync(f); } catch (e) { /* déjà absent */ }
      },
    };
    S.stockageParties = stockageParties;
    function fichierMonde(id) { return path.join(DOSSIER_PARTIES, id + '.json'); }
  }

  MC.ServeurParties = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
