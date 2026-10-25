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
