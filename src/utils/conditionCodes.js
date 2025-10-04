// Alpaca Market Data Condition Codes Mapping
// Based on SIP (Securities Information Processor) standard codes used by Alpaca
const CONDITION_CODES = {
  // Most Common Trade Conditions in Alpaca
  '@': 'Regular Sale',
  'R': 'Regular Trade',
  'T': 'Form T - Extended Hours Trade',
  'U': 'Extended Hours (Sold Out of Sequence)',
  'I': 'Odd Lot Trade',
  'P': 'Prior Reference Price',
  'W': 'Average Price Trade',
  'Z': 'Sold (Out of Sequence)',
  '4': 'Derivatively Priced',
  '7': 'Qualified Contingent Trade (QCT)',
  '9': 'Corrected Consolidated Close',

  // Opening/Closing Conditions
  'O': 'Opening Prints',
  'Q': 'Market Center Official Open',
  'M': 'Market Center Official Close',
  '6': 'Closing Prints',
  '5': 'Reopening Prints',

  // Settlement & Delivery
  'C': 'Cash Sale',
  'N': 'Next Day Settlement',

  // Trade Types
  'A': 'Acquisition',
  'B': 'Bunched Trade',
  'D': 'Distribution',
  'F': 'Intermarket Sweep Order',
  'G': 'Bunched Sold Trade',
  'H': 'Price Variation Trade',
  'K': 'Rule 155 Trade (NYSE MKT)',
  'L': 'Sold Last',
  'S': 'Split Trade',
  'V': 'Contingent Trade',
  'X': 'Cross Trade',
  'Y': 'Yellow Flag Regular Trade',
  '1': 'Stopped Stock',

  // Extended/Form T Trade Conditions
  'E': 'Auto Execution',
  'J': 'Rule 127 Trade',

  // Additional SIP Codes
  '2': 'Sold Last (Late Reporting)',
  '3': 'Sold Last (Out of Sequence)',
  '8': 'Reserved',

  // Common combinations (these might appear as arrays)
  // Alpaca often sends these as arrays like ["R"] or ["T", "I"]
  'TI': 'Extended Hours Odd Lot',
  'RI': 'Regular Odd Lot',

  // Special handling for empty or unknown
  '': 'Regular Trade',
  'UNKNOWN': 'Unknown Condition'
};

/**
 * Convert condition codes to human-readable descriptions
 * @param {Array|String} conditions - Array of condition codes or single code
 * @returns {Array} Array of condition descriptions
 */
function mapConditionCodes(conditions) {
  if (!conditions) return [];

  // Handle single string condition
  if (typeof conditions === 'string') {
    conditions = [conditions];
  }

  // Ensure it's an array
  if (!Array.isArray(conditions)) return [];

  // Handle empty array - default to Regular Trade
  if (conditions.length === 0) {
    return ['Regular Trade'];
  }

  return conditions.map(code => {
    // Handle null/undefined codes
    if (!code) return 'Regular Trade';

    const description = CONDITION_CODES[code];

    // For 'R' specifically, it's most commonly "Regular Trade"
    if (code === 'R') return 'Regular Trade';

    return description || `Unknown Condition (${code})`;
  });
}

/**
 * Get condition description for a single code
 * @param {String} code - Condition code
 * @returns {String} Condition description
 */
function getConditionDescription(code) {
  if (!code) return 'Regular Trade';

  // Special case for 'R'
  if (code === 'R') return 'Regular Trade';

  return CONDITION_CODES[code] || `Unknown Condition (${code})`;
}

module.exports = {
  mapConditionCodes,
  getConditionDescription,
  CONDITION_CODES
};