# Résultats des tests (émulateur Firestore, 60 salariés simultanés)

Méthode : versions « avant » (main) et « après » (cette branche) alternées, base vidée entre chaque passage, médiane des passages. La moitié des salariés ont un planning dans la version « après » (déclaration de pause au départ + calcul différé).

| Scénario | Mesure | Avant | Après |
|---|---|---|---|
| Normal (6 passages) | Arrivée, médiane | 325 ms | 280 ms |
| | Départ, médiane | 154 ms | 152 ms |
| | Doublons / pointages perdus | 0 / 0 | 0 / 0 |
| Base lente, +100 ms par échange (4 passages) | Arrivée, médiane | 899 ms | 893 ms |
| | Départ, médiane | 3352 ms | 3313 ms |
| | Doublons / pointages perdus | 0 / 0 | 0 / 0 |

Lecture : aucune différence mesurable au-delà du bruit (les p95 varient de 1 à 2 s d'un passage à l'autre sur l'émulateur, dans les deux versions).
Intégration (`loadtest-integration.js`) : 12 contrôles sur 12 réussis (pointages simultanés pendant 4 modifications rétroactives, historique, 4 recalculs complets sans changement, reconstruction après corruption, reprise d'un calcul raté, solde multi-jours).
Limites : émulateur et client Node (gRPC), pas la vraie base ni des tablettes ; la durée des calculs différés (de 1 s à plus de 60 s) est dominée par les reconnexions de flux de l'émulateur et se retrouve aussi dans la version « avant ».

## Nouveau passage après l'intégration (id par salarié+date)
8 passages alternés (4 avant, 4 après), émulateur redémarré. Médianes des passages individuels : arrivée 350 ms (avant, de 298 à 810) contre 270 ms (après, de 199 à 562) ; départ 58 ms (avant, de 48 à 448) contre 200 ms (après, de 89 à 494). 0 doublon, 120/120 pointages dans toutes les versions.
Le départ « après » est plus lent dans 3 passages sur 4 quand les calculs différés tournent. Avec les calculs différés désactivés (`NO_BG=1`), le départ « après » vaut 60 ms contre 47 ms (avant) ; deux passages isolés, avant comme après, ont montré 500 à 600 ms à cause de reprises de flux de l'émulateur.
Interprétation (confiance moyenne) : dans ce test, 60 « tablettes » partagent une seule connexion, donc les calculs différés d'une tablette retardent les pointages des autres. Sur de vraies tablettes (une connexion chacune) cet effet ne devrait pas exister, mais il n'est pas démontré : **à confirmer par un essai sur 2 ou 3 vraies tablettes avant la production**. Le calcul différé démarre 300 ms après la confirmation du pointage et ne retarde jamais cette confirmation.
