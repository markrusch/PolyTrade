const axios = require('axios');
const { createLogger } = require('./logger');

const logger = createLogger('MARKET-INFO');

const marketQuestionCache = {};
let questionsLoaded = false;

async function preloadMarketQuestions(limit = 500, offset = 0) {
  if (questionsLoaded) return;
  try {
    logger.debug('Pre-loading market questions from gamma API...', { limit, offset });
    const resp = await axios.get(`https://gamma-api.polymarket.com/markets?limit=${limit}&offset=${offset}`);
    const markets = resp.data?.data || resp.data || [];
    for (const m of markets) {
      if (m.conditionId && m.question) {
        marketQuestionCache[m.conditionId] = m.question;
      }
    }
    questionsLoaded = true;
    logger.info(`Loaded ${Object.keys(marketQuestionCache).length} market questions`, {
      count: Object.keys(marketQuestionCache).length
    });
  } catch (err) {
    logger.warn('Failed to pre-load market questions', { error: err.message });
  }
}

function getMarketQuestion(conditionId) {
  return marketQuestionCache[conditionId] || null;
}

async function fetchMarketByConditionId(conditionId) {
  try {
    const resp = await axios.get(`https://gamma-api.polymarket.com/markets/${conditionId}`);
    const body = resp.data?.data || resp.data;
    const candidate = Array.isArray(body) ? body[0] : body;
    return candidate || null;
  } catch (error) {
    logger.debug('HTTP market lookup failed', { conditionId, error: error.message });
    return null;
  }
}

module.exports = {
  preloadMarketQuestions,
  getMarketQuestion,
  fetchMarketByConditionId,
};
