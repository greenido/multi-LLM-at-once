/**
 * The two models the server currently exposes.
 *
 * `endpoint` exists because server.mjs still has one hardcoded route per
 * model. Once the model registry lands, this collapses to a single /query
 * route that takes the model id in the body.
 */
export const MODELS = [
  { id: 'llama3', label: 'Llama 3', emoji: '🐑', endpoint: '/query' },
  { id: 'phi3', label: 'Phi-3', emoji: '⛵️', endpoint: '/query2' },
];
