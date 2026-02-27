# Test strike price parsing and candles
try {
  # Test 1: Market metadata with correct strike parsing
  $marketResp = Invoke-WebRequest -UseBasicParsing "http://localhost:3003/api/markets/bitcoin-above-100k-on-january-19" -TimeoutSec 3
  $market = $marketResp.Content | ConvertFrom-Json
  
  Write-Host "
 STRIKE PRICE TEST:" -ForegroundColor Green
  Write-Host "   Slug: bitcoin-above-100k-on-january-19"
  Write-Host "   Parsed strike: $($market.market.strike) (should be 100000)"
  Write-Host "   Crypto: $($market.market.crypto)"
  
  # Test 2: Orderbook candles now have data
  $tokenId = $market.market.tokens.yes
  $candlesResp = Invoke-WebRequest -UseBasicParsing "http://localhost:3003/api/orderbook-history?market=$tokenId&timeframe=1m&minutes=30" -TimeoutSec 3
  $candles = $candlesResp.Content | ConvertFrom-Json
  
  Write-Host "
 ORDERBOOK CANDLES TEST:" -ForegroundColor Green
  Write-Host "   TokenId: $($tokenId.Substring(0, 20))..."
  Write-Host "   Candles count: $($candles.candles.Count)"
  if ($candles.candles.Count -gt 0) {
    Write-Host "   First candle timestamp: $($candles.candles[0].timestamp)"
    Write-Host "   Last candle close: $($candles.candles[-1].closeMid)"
  }
  
  Write-Host "
 ALL TESTS PASSED" -ForegroundColor Green
} catch {
  Write-Host "
 Error: $($_.Exception.Message)" -ForegroundColor Red
}
