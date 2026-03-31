// Quick syntax check for crossword modules
const path = require('path');
try {
  const helpers = require('./crosswordHelpers');
  console.log('✅ crosswordHelpers loaded');
  console.log('   Exported functions:', Object.keys(helpers).join(', '));
  
  const socketHandlers = require('./crosswordSocketHandlers');
  console.log('✅ crosswordSocketHandlers loaded');
  console.log('   Exported functions:', Object.keys(socketHandlers).join(', '));
  
  const routes = require('./attachCrosswordRoutes');
  console.log('✅ attachCrosswordRoutes loaded');
  console.log('   Exported functions:', Object.keys(routes).join(', '));
  
  console.log('\n✅ All modules loaded successfully!');
  process.exit(0);
} catch (err) {
  console.error('❌ Module load error:', err.message);
  console.error(err.stack);
  process.exit(1);
}
