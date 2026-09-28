# StockPulse

Indian stock market dashboard: live NSE prices, fundamentals (P/E, EBITDA, ROE, debt...),
technical indicators, candlestick charts, a buy / wait / avoid verdict with a price zone,
a Market Mood Index, search across every NSE-listed stock, and user login with a watchlist.

## Run it

    python -m venv venv
    venv\Scripts\activate          # Windows   (macOS/Linux: source venv/bin/activate)
    pip install -r requirements.txt
    python app.py

Open http://127.0.0.1:5000

## Data

- Stock list: downloaded from NSE (`EQUITY_L.csv`) on first start and refreshed weekly, so search covers every listed stock.
  If NSE blocks the download, save that file into the `data/` folder yourself.
- Prices, fundamentals, history: Yahoo Finance via `yfinance` (NSE tickers as `SYMBOL.NS`).
  NSE has no free official live API, so this feed can be delayed by up to 15 minutes.
  For true real-time ticks, swap `quote_for()` in `app.py` for a broker API (Zerodha Kite Connect, Upstox, Angel One SmartAPI).
- The page polls the price every 5 seconds and re-runs the analysis every 45 seconds.

## Market Mood Index

A 0-100 score built from India VIX, Nifty momentum and trend, how many Nifty 50 stocks trade above their
50-day average, their position in the 52-week range, and today's advancers. Below 30 is Extreme Fear,
30-50 Fear, 50-70 Greed, above 70 Extreme Greed. It is StockPulse's own calculation, not the Tickertape MMI.
The Nifty 50 list is in `NIFTY50` at the top of `app.py`; edit it when the index changes.

## Before you deploy

- Set a `SECRET_KEY` environment variable (a random one is generated in `data/secret.key` otherwise).
- Run behind gunicorn or waitress and HTTPS, and add rate limiting on the login routes.
- Signals are rule-based and for education only. They are not investment advice.
