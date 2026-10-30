// Prefer the current name while accepting existing developer environments.
function readEnvironment(suffix, environment = process.env) {
  return environment[`MULTISTUDIO_${suffix}`] || environment[`PRISM_${suffix}`];
}
module.exports = { readEnvironment };
