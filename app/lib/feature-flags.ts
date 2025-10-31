// Simple feature flags for additive, opt-in features

export function extractionEnabled(): boolean {
  const v = (process.env.FEATURE_EXTRACTION || '').toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

