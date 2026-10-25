// Proxy TCP qui ajoute une latence fixe (aller et retour) devant l'émulateur
// Firestore : simule une base de données lente. Usage : node delay-proxy.mjs 8081 8080 150
import net from "node:net";
const [listen, target, delay] = process.argv.slice(2).map(Number);
net.createServer((c) => {
  const s = net.connect(target, "127.0.0.1");
  const pipe = (from, to) => from.on("data", (d) => setTimeout(() => to.writable && to.write(d), delay)).on("close", () => setTimeout(() => to.destroy(), delay + 5)).on("error", () => to.destroy());
  pipe(c, s); pipe(s, c);
}).listen(listen, "127.0.0.1", () => console.log(`proxy :${listen} -> :${target} +${delay}ms`));
