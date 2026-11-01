// Punto de entrada: comprueba la versión de Node antes de cargar el servidor, para dar un mensaje claro.
const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`\n✖ RailES Live necesita Node.js 20 o superior (tienes ${process.version}).\n  Instálalo desde https://nodejs.org (versión LTS) o con: brew install node\n`);
  process.exit(1);
}
await import('./server.js');
