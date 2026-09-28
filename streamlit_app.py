"""
StockPulse - Streamlit version (for share.streamlit.io)
Uses the data + analysis code in app.py, so keep both files together.
"""
import html
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots
from werkzeug.security import check_password_hash, generate_password_hash

import app as core  # data, indicators, verdict and mood-index code

st.set_page_config(page_title="StockPulse", page_icon="📈", layout="wide")

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Figtree:wght@400;600&display=swap');
html, body, [class*="css"] { font-family: 'Figtree', sans-serif; }
h1, h2, h3 { font-family: 'Bricolage Grotesque', sans-serif !important; letter-spacing: -0.02em; }
.verdict { border-radius: 18px; padding: 22px 26px; color: #fff; }
.verdict .lbl { opacity: .85; font-size: .95rem; }
.verdict .act { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 2.3rem; line-height: 1.05; margin: 4px 0 8px; }
.verdict ul { margin: 12px 0 0; padding-left: 18px; font-size: .95rem; }
.zone-name { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 2rem; }
</style>
""", unsafe_allow_html=True)


# ---------------------------------------------------------------- helpers
def fmt(v, ty):
    if v is None:
        return "—"
    return {"x": f"{v:,.2f}x", "n": f"{v:,.2f}", "inr": f"₹{v:,.2f}", "cr": f"₹{v / 1e7:,.0f} Cr",
            "pc": f"{v:.1f}%", "vol": f"{v:,.0f}"}[ty]


def mmi_color(s):
    return "#e5484d" if s < 30 else "#f59f3a" if s < 50 else "#5fbf45" if s < 70 else "#12a672"


# ---------------------------------------------------------------- accounts (SQLite)
def dbc():
    c = sqlite3.connect(core.DB)
    c.row_factory = sqlite3.Row
    return c


def do_register(username, email, pw):
    username, email = username.strip(), email.strip().lower()
    if not re.fullmatch(r"[A-Za-z0-9_.]{3,24}", username):
        return "Username must be 3–24 characters: letters, numbers, _ or ."
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return "Enter a valid email address."
    if len(pw) < 8:
        return "Password must be at least 8 characters."
    try:
        with dbc() as c:
            cur = c.execute("INSERT INTO users(username,email,pw_hash) VALUES(?,?,?)",
                            (username, email, generate_password_hash(pw)))
            uid = cur.lastrowid
    except sqlite3.IntegrityError:
        return "That username or email is already registered."
    st.session_state.user = {"id": uid, "name": username}
    return None


def do_login(ident, pw):
    ident = ident.strip()
    with dbc() as c:
        row = c.execute("SELECT * FROM users WHERE username=? OR email=?", (ident, ident.lower())).fetchone()
    if not row or not check_password_hash(row["pw_hash"], pw):
        return "Wrong username/email or password."
    st.session_state.user = {"id": row["id"], "name": row["username"]}
    return None


def wl_list(uid):
    with dbc() as c:
        return [r["symbol"] for r in c.execute(
            "SELECT symbol FROM watchlist WHERE user_id=? ORDER BY added DESC", (uid,))]


def wl_add(uid, sym):
    with dbc() as c:
        c.execute("INSERT OR IGNORE INTO watchlist(user_id,symbol) VALUES(?,?)", (uid, sym))


def wl_del(uid, sym):
    with dbc() as c:
        c.execute("DELETE FROM watchlist WHERE user_id=? AND symbol=?", (uid, sym))


def open_stock(sym):
    st.session_state.sym = sym
    st.session_state.page = "Stock analysis"


# ---------------------------------------------------------------- sidebar: login + watchlist
st.session_state.setdefault("page", "Market mood")
st.session_state.setdefault("sym", None)

with st.sidebar:
    st.markdown("## 📈 StockPulse")
    user = st.session_state.get("user")
    if user:
        st.write(f"Signed in as **{user['name']}**")
        if st.button("Log out"):
            del st.session_state["user"]
            st.rerun()
        st.markdown("#### My watchlist")
        wl = wl_list(user["id"])
        if not wl:
            st.caption("Empty. Open a stock and press “Add to watchlist”.")
        for s in wl:
            c1, c2 = st.columns([4, 1])
            c1.button(s, key=f"open_{s}", on_click=open_stock, args=(s,), use_container_width=True)
            c2.button("✕", key=f"rm_{s}", on_click=wl_del, args=(user["id"], s))
    else:
        mode = st.radio("Account", ["Log in", "Create account"], horizontal=True, label_visibility="collapsed")
        with st.form("auth_form"):
            if mode == "Log in":
                a = st.text_input("Username or email")
                p = st.text_input("Password", type="password")
                go_ = st.form_submit_button("Log in", use_container_width=True)
                if go_:
                    err = do_login(a, p)
                    if err:
                        st.error(err)
                    else:
                        st.rerun()
            else:
                u = st.text_input("Username")
                e = st.text_input("Email")
                p = st.text_input("Password (8+ characters)", type="password")
                go_ = st.form_submit_button("Create account", use_container_width=True)
                if go_:
                    err = do_register(u, e, p)
                    if err:
                        st.error(err)
                    else:
                        st.rerun()
        st.caption("Log in to keep a watchlist of your favourite stocks.")


# ---------------------------------------------------------------- top: index strip
@st.fragment(run_every=15)
def index_strip():
    items = [("NIFTY 50", "^NSEI"), ("SENSEX", "^BSESN"), ("BANK NIFTY", "^NSEBANK"),
             ("NIFTY IT", "^CNXIT"), ("INDIA VIX", "^INDIAVIX")]

    def one(it):
        try:
            return core.quote_for(it[1])
        except Exception:  # noqa: BLE001
            return None

    with ThreadPoolExecutor(5) as ex:
        qs = list(ex.map(one, items))
    cols = st.columns(len(items))
    for col, (name, _), q in zip(cols, items, qs):
        if q:
            col.metric(name, f"{q['price']:,.2f}", f"{q['change_pct']:+.2f}%",
                       delta_color="inverse" if name == "INDIA VIX" else "normal")
        else:
            col.metric(name, "—")
    st.caption(("🟢 Market open" if core.market_open() else "⚪ Market closed") +
               " · prices come from Yahoo Finance and may be delayed up to 15 minutes")


index_strip()

page = st.radio("View", ["Market mood", "Stock analysis"], horizontal=True, key="page",
                label_visibility="collapsed")
st.divider()


# ---------------------------------------------------------------- page 1: market mood
def mood_page():
    st.title("Market Mood Index")
    st.write("A 0 to 100 score for how fearful or greedy Indian investors are right now.")
    with st.spinner("Reading the market. The first load can take about 20 seconds…"):
        try:
            d = core.compute_mmi()
        except Exception as e:  # noqa: BLE001
            st.error(f"Couldn't compute the mood index: {e}")
            return
    c1, c2 = st.columns([1, 1], gap="large")
    with c1:
        fig = go.Figure(go.Indicator(
            mode="gauge+number", value=round(d["score"]),
            gauge={"axis": {"range": [0, 100]}, "bar": {"color": "#121a4a", "thickness": 0.25},
                   "steps": [{"range": [0, 30], "color": "#e5484d"}, {"range": [30, 50], "color": "#f59f3a"},
                             {"range": [50, 70], "color": "#8bd46e"}, {"range": [70, 100], "color": "#12a672"}]}))
        fig.update_layout(height=300, margin=dict(l=20, r=20, t=30, b=0))
        st.plotly_chart(fig, use_container_width=True)
        st.markdown(f"<div class='zone-name' style='color:{mmi_color(d['score'])}'>{html.escape(d['zone'])}</div>",
                    unsafe_allow_html=True)
        st.write(d["advice"])
        st.caption("Updated " + d["updated"])
    with c2:
        st.markdown("#### What is moving the score")
        for comp in d["components"]:
            st.markdown(f"**{comp['name']}**: {round(comp['score'])}/100")
            st.progress(int(comp["score"]) / 100, text=comp["detail"])
    st.divider()
    try:
        mv = core.movers()
        g1, g2 = st.columns(2)
        for col, title, key in ((g1, "Top gainers (Nifty 50)", "gainers"), (g2, "Top losers (Nifty 50)", "losers")):
            col.markdown(f"#### {title}")
            df = pd.DataFrame(mv[key]).rename(columns={"symbol": "Stock", "price": "Price", "change_pct": "Change %"})
            col.dataframe(df, hide_index=True, use_container_width=True,
                          column_config={"Price": st.column_config.NumberColumn(format="₹%.2f"),
                                         "Change %": st.column_config.NumberColumn(format="%+.2f%%")})
    except Exception as e:  # noqa: BLE001
        st.caption(f"Movers unavailable: {e}")


# ---------------------------------------------------------------- page 2: stock analysis
@st.cache_data(ttl=45, show_spinner=False)
def load_stock(sym):
    quote = core.live_quote(sym)
    fund = core.fundamentals(sym)
    core.daily(sym)
    px = quote["price"]
    sigs, summary, levels, tech = core.technical_analysis(sym, px)
    fview, fnotes = core.fundamental_view(fund)
    verdict = core.make_verdict(px, summary, levels, tech, fview, fnotes)
    name = fund.get("name") or next((n for s, n in core.universe() if s == sym), sym)
    return {"symbol": sym, "name": name, "quote": quote, "fund": fund, "fview": fview, "fnotes": fnotes,
            "signals": sigs, "summary": summary, "levels": levels, "tech": tech, "verdict": verdict}


@st.fragment(run_every=10)
def live_header(sym, name, sector):
    try:
        q = core.live_quote(sym)
    except Exception as e:  # noqa: BLE001
        st.error(str(e))
        return
    c1, c2 = st.columns([2, 1])
    c1.markdown(f"## {name}")
    c1.caption(f"NSE: {sym}" + (f" · {sector}" if sector else "") +
               (" · 🟢 Live" if core.market_open() else " · Market closed, showing last close"))
    c2.metric("Price", f"₹{q['price']:,.2f}", f"{q['change']:+.2f} ({q['change_pct']:+.2f}%)")


def zone_figure(v, px):
    lo = min(v["stop_loss"], px) * 0.995
    hi = max(v["target"], px) * 1.005
    fig = go.Figure()
    fig.add_shape(type="rect", x0=v["zone_low"], x1=v["zone_high"], y0=0.25, y1=0.75,
                  fillcolor="#5cd0a0", line_width=0, opacity=0.8)
    for x, label, col in ((v["stop_loss"], "Stop", "#dc3348"), (px, "Now", "#121a4a"), (v["target"], "Target", "#0f9d68")):
        fig.add_shape(type="line", x0=x, x1=x, y0=0.05, y1=0.95, line=dict(color=col, width=3))
        fig.add_annotation(x=x, y=1.05, text=f"{label}<br>₹{x:,.0f}", showarrow=False, font=dict(color=col, size=12))
    fig.update_xaxes(range=[lo, hi], showgrid=False, tickprefix="₹")
    fig.update_yaxes(visible=False, range=[0, 1.4])
    fig.update_layout(height=190, margin=dict(l=10, r=10, t=10, b=30), plot_bgcolor="white")
    return fig


def price_chart(sym, rng, show_bb):
    period, interval, tail = core.RANGES[rng]
    intra = period is not None
    df = core.intraday(sym, period, interval) if intra else core.daily(sym)
    d = core.indicators(df)
    if tail:
        d = d.tail(tail)
    x = d.index
    fig = make_subplots(rows=3, cols=1, shared_xaxes=True, row_heights=[0.62, 0.14, 0.24], vertical_spacing=0.025)
    fig.add_trace(go.Candlestick(x=x, open=d["Open"], high=d["High"], low=d["Low"], close=d["Close"], name="Price",
                                 increasing_line_color="#0f9d68", decreasing_line_color="#dc3348"), row=1, col=1)
    for col, name, color in (("sma20", "SMA 20", "#ff9d1f"), ("sma50", "SMA 50", "#2b3796"), ("sma200", "SMA 200", "#8a4bd6")):
        fig.add_trace(go.Scatter(x=x, y=d[col], name=name, line=dict(color=color, width=1.6)), row=1, col=1)
    if show_bb:
        for col, name in (("bb_up", "Bollinger upper"), ("bb_lo", "Bollinger lower")):
            fig.add_trace(go.Scatter(x=x, y=d[col], name=name, line=dict(color="#9aa3d6", width=1, dash="dot")), row=1, col=1)
    vcol = ["rgba(15,157,104,.45)" if c >= o else "rgba(220,51,72,.45)" for o, c in zip(d["Open"], d["Close"])]
    fig.add_trace(go.Bar(x=x, y=d["Volume"], marker_color=vcol, name="Volume", showlegend=False), row=2, col=1)
    fig.add_trace(go.Scatter(x=x, y=d["rsi"], name="RSI (14)", line=dict(color="#2b3796", width=1.8)), row=3, col=1)
    fig.add_hline(y=70, line=dict(color="#dc3348", dash="dash", width=1), row=3, col=1)
    fig.add_hline(y=30, line=dict(color="#0f9d68", dash="dash", width=1), row=3, col=1)
    breaks = [dict(bounds=["sat", "mon"])]
    if intra:
        breaks.append(dict(bounds=[15.5, 9.25], pattern="hour"))
    fig.update_xaxes(rangebreaks=breaks, rangeslider_visible=False)
    fig.update_yaxes(title_text="Price (₹)", row=1, col=1)
    fig.update_yaxes(title_text="Volume", row=2, col=1)
    fig.update_yaxes(title_text="RSI", range=[0, 100], row=3, col=1)
    fig.update_layout(height=680, template="plotly_white", margin=dict(l=10, r=10, t=10, b=10),
                      legend=dict(orientation="h", y=1.03), hovermode="x unified")
    return fig


def stock_page():
    opts = [f"{s} — {n}" for s, n in core.universe()]

    def on_pick():
        v = st.session_state.get("pick")
        if v:
            st.session_state.sym = v.split(" — ")[0]

    def on_type():
        v = core.norm(st.session_state.get("typed", ""))
        if v:
            st.session_state.sym = v

    c1, c2 = st.columns([3, 2])
    c1.selectbox("Search any NSE stock", opts, index=None, key="pick", on_change=on_pick,
                 placeholder="Type a company name or symbol, e.g. Reliance")
    c2.text_input("Or type an NSE symbol", key="typed", on_change=on_type, placeholder="e.g. TCS, M&M, IRCTC")

    sym = core.norm(st.session_state.get("sym") or "")
    if not sym:
        st.info("Search for a stock above to see its live price, technicals, fundamentals and buy verdict.")
        return
    try:
        with st.spinner(f"Loading {sym}…"):
            d = load_stock(sym)
    except Exception as e:  # noqa: BLE001
        st.error(f"We couldn't load {sym}: {e}")
        st.caption("Check the NSE symbol (for example RELIANCE, TCS or M&M).")
        return

    q, f, v, t = d["quote"], d["fund"], d["verdict"], d["tech"]
    live_header(sym, d["name"], f.get("sector"))

    user = st.session_state.get("user")
    if user:
        on = sym in wl_list(user["id"])
        if st.button("★ Remove from watchlist" if on else "☆ Add to watchlist"):
            (wl_del if on else wl_add)(user["id"], sym)
            st.rerun()
    else:
        st.caption("Log in from the sidebar to add this stock to a watchlist.")

    # ----- verdict
    bg = {"buy": "linear-gradient(135deg,#0b7a52,#12a672)", "sell": "linear-gradient(135deg,#a51d31,#dc3348)",
          "neutral": "linear-gradient(135deg,#1c2670,#3341a8)"}[v["tone"]]
    lis = "".join(f"<li>{html.escape(r)}</li>" for r in v["reasons"])
    vc1, vc2 = st.columns([1, 1.15], gap="large")
    with vc1:
        st.markdown(f"<div class='verdict' style='background:{bg}'><div class='lbl'>Verdict at ₹{q['price']:,.2f}</div>"
                    f"<div class='act'>{html.escape(v['action'])}</div><div>{html.escape(v['headline'])}</div>"
                    f"<ul>{lis}</ul></div>", unsafe_allow_html=True)
    with vc2:
        st.markdown("#### Price zone")
        m1, m2, m3 = st.columns(3)
        m1.metric("Buy zone", f"₹{v['zone_low']:,.0f} – ₹{v['zone_high']:,.0f}")
        m2.metric("Stop-loss", f"₹{v['stop_loss']:,.2f}")
        m3.metric("Target", f"₹{v['target']:,.2f}")
        st.plotly_chart(zone_figure(v, q["price"]), use_container_width=True)
        rr = f" Risk to reward from here is about 1 : {v['risk_reward']:.1f}." if v["risk_reward"] else ""
        st.caption(("The price is inside or close to the value zone." if v["in_zone"]
                    else "The price is above the value zone.") + rr)

    # ----- chart
    st.markdown("### Chart")
    cc1, cc2 = st.columns([3, 1])
    rng = cc1.radio("Range", list(core.RANGES.keys()), index=3, horizontal=True, label_visibility="collapsed")
    bb = cc2.checkbox("Bollinger Bands")
    try:
        st.plotly_chart(price_chart(sym, rng, bb), use_container_width=True)
    except Exception as e:  # noqa: BLE001
        st.warning(str(e))

    # ----- fundamentals
    st.markdown(f"### Fundamentals: {d['fview']}")
    F = [("P/E ratio", f["pe"], "x", "Price you pay for each ₹1 of yearly profit."),
         ("Forward P/E", f["forward_pe"], "x", "P/E using expected profits for the next year."),
         ("P/B ratio", f["pb"], "x", "Price compared with book value per share."),
         ("EPS (TTM)", f["eps"], "inr", "Profit per share over the last 12 months."),
         ("EBITDA", f["ebitda"], "cr", "Operating profit before interest, tax, depreciation and amortisation."),
         ("EV / EBITDA", f["ev_ebitda"], "x", "What the whole business costs versus its operating profit."),
         ("Market cap", f["market_cap"], "cr", "Total value of all shares."),
         ("Revenue", f["revenue"], "cr", "Sales over the last 12 months."),
         ("Net profit", f["net_income"], "cr", "Profit after all costs, last 12 months."),
         ("ROE", f["roe"], "pc", "Profit earned on shareholders' money."),
         ("ROA", f["roa"], "pc", "Return on assets."),
         ("Net margin", f["profit_margin"], "pc", "Share of sales that becomes profit."),
         ("Operating margin", f["operating_margin"], "pc", "Share of sales left after operating costs."),
         ("Revenue growth", f["revenue_growth"], "pc", "Latest yearly change in sales."),
         ("Earnings growth", f["earnings_growth"], "pc", "Latest yearly change in profit."),
         ("Debt / Equity", f["debt_to_equity"], "n", "Borrowings versus shareholders' money. Lower is safer."),
         ("Dividend yield", f["dividend_yield"], "pc", "Yearly dividend as a % of the price."),
         ("Beta", f["beta"], "n", "How much the stock swings versus the market. 1 = moves with it."),
         ("52-week high", t["high52"], "inr", "Highest price in the last year."),
         ("52-week low", t["low52"], "inr", "Lowest price in the last year.")]
    for i in range(0, len(F), 5):
        cols = st.columns(5)
        for col, (lab, val, ty, tip) in zip(cols, F[i:i + 5]):
            col.metric(lab, fmt(val, ty), help=tip)
    for n in d["fnotes"]:
        st.markdown(("🟢 " if n["tone"] == "buy" else "🔴 ") + n["text"])

    # ----- technicals
    st.markdown("### Technical indicators")
    sm = d["summary"]
    k1, k2, k3 = st.columns(3)
    k1.metric("Buy signals", sm["buy"])
    k2.metric("Neutral", sm["neutral"])
    k3.metric("Sell signals", sm["sell"])
    icon = {"buy": "🟢 Buy", "sell": "🔴 Sell", "neutral": "⚪ Neutral"}
    tdf = pd.DataFrame([{"Group": s["group"], "Indicator": s["name"], "Value": s["value"],
                         "Signal": icon[s["signal"]], "What it means": s["note"]} for s in d["signals"]])
    st.dataframe(tdf, hide_index=True, use_container_width=True,
                 column_config={"Value": st.column_config.NumberColumn(format="%.2f")})
    st.markdown("#### Support and resistance")
    L = d["levels"]
    for col, (lab, val) in zip(st.columns(5), (("S2", L["s2"]), ("S1", L["s1"]), ("Pivot", L["pivot"]),
                                                ("R1", L["r1"]), ("R2", L["r2"]))):
        col.metric(lab, f"₹{val:,.1f}")


if page == "Market mood":
    mood_page()
else:
    stock_page()

st.divider()
st.caption("Signals are rule-based on past prices and are for learning, not investment advice. "
           "Please talk to a SEBI-registered adviser before you invest.")
