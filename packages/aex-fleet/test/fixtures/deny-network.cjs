// Compatibility tests must remain local even if an upstream CLI changes its behavior.
// Exit immediately instead of throwing an error the CLI could catch and ignore.
const deny = () => { process.stderr.write('UNEXPECTED_NETWORK_IN_LOCAL_TEST\n'); process.exit(97) }
globalThis.fetch = deny
require('node:net').Socket.prototype.connect = deny
require('node:tls').connect = deny
require('node:dgram').createSocket = deny
require('node:module').syncBuiltinESMExports()
