module.exports.register = (ctx) => { ctx.registerHandler('ping', (x) => `pong:${x}`); };
