/**
 * Credit costs for AI generation models.
 * Used by xenoRoutes to determine how many credits to deduct per request.
 */

const IMAGE_COSTS = {
  'fast': 5,
  'classic': 5,
  'flux-dev': 10,
  'ideogram': 10,
  'auto': 10,
  'flux-pro-plus': 20,
  'imagen3': 20,
  'seedream-4-5': 20,
  'imagen4': 30,
  'imagen4-ultra': 30,
  'flux-2-max': 30,
  'gpt-high': 25,
  'flux-kontext-high': 20,
};

const EDIT_COST = 10;
const VIDEO_COST = 100;
const AUDIO_COST = 40;

export function getCreditCost(type, model) {
  switch (type) {
    case 'image':
      return IMAGE_COSTS[model] || 10;
    case 'edit':
    case 'upscale':
      return EDIT_COST;
    case 'video':
      return VIDEO_COST;
    case 'audio':
      return AUDIO_COST;
    default:
      return 10;
  }
}
