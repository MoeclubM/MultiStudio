const { Sentences } = require('./sentences.cjs');
module.exports.nodes = { 'sentence-split': { execute: ({ input }) => input, createTextStream: context => new Sentences(context) } };
