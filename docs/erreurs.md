# Codes d'erreur — catalogue

Chaque erreur que le jeu ou le serveur journalise avec un code stable
(`E-<DOMAINE>-<NNN>`, SPEC-BANC-108) est recensée ici : sa cause et la
conduite à tenir. Le code figure dans l'entrée du journal (`MC.Journal`,
`src/journal.js`), dans le fichier du serveur (`logs/serveur-<date>.log`), dans
le rapport de test et à la console du navigateur : un `grep E-SAVE-002`
retrouve chaque occurrence.

Règles :

- un code ne change jamais de sens et n'est jamais réutilisé ; une erreur qui
  disparaît garde sa ligne, marquée « retiré » ;
- tout code écrit dans `src/` ou `server.js` doit avoir sa ligne ici
  (vérifié par `tests/spec-journal-statique.js`) ;
- le texte lisible montré au joueur (`{ joueur: … }`) ne contient pas le code :
  il est pour le joueur, le code pour celui qui lit le journal.

| Code | Domaine | Cause | Conduite à tenir |
|---|---|---|---|
| E-SAVE-001 | SAVE | Une clé du stockage des parties (index ou partie, `localStorage` du navigateur ou fichier du dossier des parties côté serveur) contient un texte qui n'est pas du JSON valide. La lecture rend la valeur par défaut (index vide, partie vierge). | Regarder la clé citée dans les données de l'entrée ; restaurer le fichier depuis une copie ou supprimer la clé corrompue. Rien n'est écrasé tant que la partie n'est pas sauvegardée. |
| E-SAVE-002 | SAVE | La sauvegarde d'une partie porte une version d'enveloppe (`slotV`) que ce jeu ne connaît pas (partie écrite par une autre version). Le joueur voit « Sauvegarde illisible ». | Ouvrir la partie avec la version du jeu qui l'a écrite, ou l'exporter puis la réimporter par le serveur ; la version trouvée et la version attendue sont dans les données de l'entrée. |
| E-SAVE-003 | SAVE | Le contenu de la sauvegarde (`MC.Save.apply`) est d'un format inconnu ou incompatible malgré une enveloppe valide. Le joueur voit « Sauvegarde illisible ». | Vérifier la version de contenu (`v`) dans les données de l'entrée ; une migration manque dans `src/save.js` si la version est plus ancienne que l'actuelle. |
| E-SAVE-004 | SAVE | Le serveur local a refusé la demande de sauvegarde immédiate du joueur (« Sauvegarder » du menu) ; le motif renvoyé par le serveur est dans les données. | Lire le motif : sans partie active, créer ou charger une partie ; demande trop rapprochée, réessayer après quelques secondes ; sinon consulter le journal du serveur à la même heure. |
| E-SAVE-005 | SAVE | La demande de sauvegarde immédiate n'a pas pu joindre le serveur local (connexion coupée, serveur arrêté). | Vérifier que `node server.js` tourne toujours ; relancer le serveur — il sauvegarde lui-même à l'arrêt, à la pause et à la cadence prévue. |
| E-SERV-001 | LANCEUR | Le serveur n'a pas pu ouvrir son port d'écoute (port déjà utilisé, aucun port libre dans la plage de repli, droits insuffisants). Le processus s'arrête avec le code 1. | Libérer le port, ou relancer avec `--port <n>` (ou `--port 0` pour un port éphémère) ; le motif exact est dans les données et la pile de l'entrée. |
| E-SERV-002 | LANCEUR | `--partie <id>` désigne une partie absente de l'index du dossier des parties (ou un identifiant invalide). Le processus s'arrête avec le code 1. | Lister les parties du dossier (`--dossier-parties`) et relancer avec un identifiant existant, ou sans `--partie`. |
| E-SERV-003 | LANCEUR | Les paramètres de lancement sont invalides (paramètre inconnu, valeur hors bornes ou mal formée). L'aide du paramètre fautif est affichée et le processus s'arrête avec le code 1. | Corriger la ligne de commande d'après l'aide affichée ; `node server.js --aide` liste tous les paramètres. |
