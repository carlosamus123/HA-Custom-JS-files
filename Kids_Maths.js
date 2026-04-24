// ══════════════════════════════════════════════════════════════════════════════
//  Kids' Maths Dashboard  — Home Assistant Custom Card
//  Version: 1.0.0
//  License: MIT
//
//  A gamified daily maths practice card for children, featuring:
//  - AI-generated questions via OpenAI (GPT-4o) tuned to child's level
//  - Token economy / reward shop with parent-configured prizes
//  - AI tutor character that guides without giving answers
//  - Internet access toggle (reward for completing daily question)
//  - Weak-topic tracking to focus future questions
//  - Bonus + unlimited extra questions
//
//  REQUIREMENTS
//  ─────────────────────────────────────────────────────────────────────────────
//  1. An OpenAI API key stored in a Home Assistant input_text entity.
//     The card reads the key at runtime — it is NEVER embedded here.
//
//  2. The following HA helper entities (create via Settings > Helpers):
//     • input_text.kids_maths_openai_key      ← paste your OpenAI key here
//     • input_boolean.kids_maths_internet     ← controls internet access reward
//     • input_text.kids_maths_weak_topics     ← JSON; auto-managed by card
//     • input_text.kids_maths_question_cache  ← date/topic cache; auto-managed
//     • input_text.kids_maths_token_balance   ← numeric balance; auto-managed
//
//  YAML CONFIGURATION (in your Lovelace dashboard)
//  ─────────────────────────────────────────────────────────────────────────────
//  type: custom:kids-maths-dashboard
//
//  # Required — all fields have defaults matching the entity names above
//  openai_key_entity:    input_text.kids_maths_openai_key
//  internet_entity:      input_boolean.kids_maths_internet
//  weak_topics_entity:   input_text.kids_maths_weak_topics
//  cache_entity:         input_text.kids_maths_question_cache
//  tokens_entity:        input_text.kids_maths_token_balance
//
//  # Optional — personalise the experience
//  child_name:           "Alex"          # shown in feedback messages
//  child_age:            9               # used in AI prompt
//  school_year:          "Year 4"        # UK year group (or "Grade 3", etc.)
//  maths_level:          "Year 3"        # working level (can be below school year)
//  tutor_name:           "Aria"          # name of the AI tutor character
//  tutor_avatar:         "🤖"            # emoji avatar for tutor
//  theme_primary:        "#00c8a0"       # accent colour (hex)
//  theme_danger:         "#ff3355"       # danger/wrong colour (hex)
//  theme_gold:           "#ffc800"       # token/reward colour (hex)
//
//  # Shop items — customise prizes to suit your family
//  shop_items:
//    - id: snack
//      icon: "🍪"
//      label: "Pick a Snack"
//      cost: 5
//      tier: bronze
//      desc: "You choose the snack tonight!"
//    - id: screentime
//      icon: "⏰"
//      label: "+30 Min Screen Time"
//      cost: 5
//      tier: bronze
//      desc: "30 extra minutes before bed"
//    - id: movie
//      icon: "🎬"
//      label: "Movie Night Pick"
//      cost: 10
//      tier: silver
//      desc: "You choose the film tonight!"
//    - id: toy
//      icon: "🎁"
//      label: "Toy up to £10"
//      cost: 20
//      tier: gold
//      desc: "Pick any toy up to £10!"
//
//  SECURITY NOTES
//  ─────────────────────────────────────────────────────────────────────────────
//  • Your OpenAI key lives only in HA; this file contains NO credentials.
//  • Token balances and session history are stored in browser localStorage
//    under the key "kids_maths_v1". Clear via browser devtools if needed.
//  • The AI tutor is instructed never to reveal question answers directly.
//  • This card makes outbound requests only to api.openai.com.
//
//  INSTALLATION
//  ─────────────────────────────────────────────────────────────────────────────
//  1. Copy this file to your HA config/www/ folder.
//  2. Add as a resource in Settings > Dashboards > Resources:
//       URL: /local/kids-maths-dashboard.js   Type: JavaScript module
//  3. Add to a dashboard card with the YAML above.
//  4. Enter your OpenAI key into the input_text helper entity.
// ══════════════════════════════════════════════════════════════════════════════

"use strict";

// ── CONSTANTS ────────────────────────────────────────────────────────────────

const DEFAULT_SHOP_ITEMS = [
  { id:"snack",      icon:"🍪", label:"Pick a Snack",        cost:5,  tier:"bronze", desc:"You choose the snack tonight!" },
  { id:"screentime", icon:"⏰", label:"+30 Min Screen Time",  cost:5,  tier:"bronze", desc:"30 extra minutes before bed" },
  { id:"meal",       icon:"🍽️", label:"Pick Dinner Tonight",  cost:5,  tier:"bronze", desc:"You choose what's for dinner!" },
  { id:"movie",      icon:"🎬", label:"Movie Night Pick",     cost:10, tier:"silver", desc:"You choose the film tonight!" },
  { id:"treat",      icon:"🧁", label:"Special Treat Night",  cost:10, tier:"silver", desc:"A special evening treat of your choice!" },
  { id:"toy",        icon:"🎁", label:"Toy up to £10",        cost:20, tier:"gold",   desc:"Pick any toy up to £10!" },
];

const DIFFICULTY_TOKENS = { 1: 0.5, 2: 1, 3: 2 };

const TOPICS = [
  "Addition","Subtraction","Multiplication","Division",
  "Fractions","Place Value","Rounding","Measurement",
  "Time","Geometry","Sequences","Word Problems",
];

const TIER_ORDER  = ["bronze","silver","gold"];
const TIER_LABELS = { bronze:"[BRONZE] REWARDS", silver:"[SILVER] REWARDS", gold:"[GOLD] REWARDS" };

// ── STYLES ───────────────────────────────────────────────────────────────────

function buildCSS(cfg) {
  const p  = cfg.theme_primary || "#00c8a0";
  const d  = cfg.theme_danger  || "#ff3355";
  const g  = cfg.theme_gold    || "#ffc800";
  const bg = cfg.theme_bg      || "#07111a";

  // Derive slightly transparent variants
  const pA = p + "26"; // ~15% alpha
  const pB = p + "55"; // ~33%
  const dA = d + "26";
  const gA = g + "20";
  const gB = g + "66";

  return `
@import url('https://fonts.googleapis.com/css2?family=Creepster&family=Nunito:wght@400;600;700;800;900;1000&family=Share+Tech+Mono&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:host{display:block}

:host{
  --clr-p:${p};
  --clr-d:${d};
  --clr-g:${g};
  --clr-bg:${bg};
}

.shell{
  font-family:'Nunito',sans-serif;
  min-height:100vh;color:#e8f4f0;
  -webkit-font-smoothing:antialiased;
  padding-bottom:40px;
  background:var(--clr-bg);
  background-image:
    radial-gradient(ellipse at 10% 20%,${pA} 0%,transparent 50%),
    radial-gradient(ellipse at 90% 80%,${dA} 0%,transparent 50%);
}
.shell::before{
  content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px);
}

/* ── TOPBAR ── */
.topbar{
  display:flex;justify-content:space-between;align-items:center;
  padding:12px 18px;
  background:rgba(0,10,18,0.95);border-bottom:2px solid var(--clr-p);
  position:sticky;top:0;z-index:100;
  box-shadow:0 2px 20px ${pA};
}
.logo{
  font-family:'Creepster',cursive;font-size:20px;letter-spacing:2px;
  color:var(--clr-p);text-shadow:0 0 10px ${pA};
}
.logo span{color:var(--clr-d);text-shadow:0 0 10px ${dA};}

.token-hud{
  display:flex;align-items:center;gap:8px;
  background:${gA};border:1.5px solid ${gB};
  border-radius:8px;padding:5px 14px;cursor:pointer;transition:all 0.2s;
}
.token-hud:hover{background:${g}26;border-color:var(--clr-g);}
.token-hud-val{font-family:'Share Tech Mono',monospace;font-size:16px;font-weight:700;color:var(--clr-g);}
.token-hud-label{font-size:10px;color:${gB};font-weight:700;letter-spacing:1px;text-transform:uppercase}

.inet-badge{font-size:10px;font-weight:700;padding:4px 11px;border-radius:6px;font-family:'Share Tech Mono',monospace;letter-spacing:1px;}
.inet-badge.on{background:rgba(0,200,100,0.15);color:#00c864;border:1.5px solid rgba(0,200,100,0.5);}
.inet-badge.off{background:${dA};color:var(--clr-d);border:1.5px solid ${d}80;}

/* ── MARQUEE ── */
.marquee-wrap{overflow:hidden;padding:5px 0;border-bottom:1px solid ${pB}33;background:${pA}10;}
.marquee-inner{display:inline-block;font-family:'Share Tech Mono',monospace;font-size:9px;font-weight:700;
  letter-spacing:4px;text-transform:uppercase;color:${p}66;white-space:nowrap;animation:marquee-scroll 30s linear infinite;}
@keyframes marquee-scroll{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

/* ── NAV TABS ── */
.nav-tabs{display:flex;border-bottom:1px solid ${pA};}
.nav-tab{
  flex:1;padding:11px 8px;text-align:center;font-size:11px;font-weight:800;
  letter-spacing:1.5px;text-transform:uppercase;font-family:'Share Tech Mono',monospace;
  background:none;border:none;color:${p}66;cursor:pointer;
  border-bottom:3px solid transparent;transition:all 0.2s;
}
.nav-tab:hover{color:${p}cc;background:${pA}10;}
.nav-tab.active{color:var(--clr-p);border-bottom-color:var(--clr-p);background:${pA}18;}

/* ── CARDS ── */
.card{
  margin:14px 14px;background:rgba(5,18,28,0.9);
  border:1.5px solid ${pA};border-radius:12px;padding:18px;
  position:relative;overflow:hidden;
}
.card::before{
  content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,transparent,var(--clr-p),transparent);opacity:0.4;
}
.card-danger{border-color:${dA};}
.card-danger::before{background:linear-gradient(90deg,transparent,var(--clr-d),transparent);}

/* ── PROGRESS DOTS ── */
.progress-row{display:flex;align-items:center;gap:12px;padding:10px 18px 2px;}
.dots{display:flex;gap:7px;}
.dot{width:10px;height:10px;border-radius:2px;background:${pA};transition:all 0.3s;border:1px solid ${pB};}
.dot.done{background:var(--clr-p);border-color:var(--clr-p);box-shadow:0 0 6px ${pA};}
.dot.active{background:var(--clr-d);border-color:var(--clr-d);transform:scale(1.3);box-shadow:0 0 10px ${dA};}
.step-label{font-size:10px;font-weight:800;color:${p}99;letter-spacing:1px;text-transform:uppercase;font-family:'Share Tech Mono',monospace;}

/* ── BADGES ── */
.topic-pill{display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;
  padding:3px 10px;border-radius:4px;background:${pA};color:var(--clr-p);border:1px solid ${pB};margin-bottom:6px;font-family:'Share Tech Mono',monospace;}
.diff-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;
  padding:3px 9px;border-radius:4px;margin-bottom:12px;margin-left:6px;font-family:'Share Tech Mono',monospace;}
.diff-badge.d1{background:rgba(0,200,100,0.1);color:#00c864;border:1px solid rgba(0,200,100,0.3);}
.diff-badge.d2{background:${gA};color:var(--clr-g);border:1px solid ${gB};}
.diff-badge.d3{background:${dA};color:var(--clr-d);border:1px solid ${d}80;}
.token-preview{font-size:11px;font-weight:700;color:var(--clr-g);letter-spacing:0.5px;font-family:'Share Tech Mono',monospace;}

/* ── QUESTION ── */
.question-text{font-size:20px;font-weight:900;color:#e8f4f0;line-height:1.4;margin-bottom:18px;}

/* ── OPTIONS ── */
.opts-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.opt-btn{
  background:rgba(255,255,255,0.04);border:1.5px solid ${pA};
  border-radius:8px;padding:14px 10px;
  font-family:'Nunito',sans-serif;font-size:17px;font-weight:800;
  color:#c8e8e0;cursor:pointer;transition:all 0.15s;width:100%;
}
.opt-btn:hover:not(:disabled){
  background:${pA};border-color:var(--clr-p);color:var(--clr-p);
  transform:translateY(-2px);box-shadow:0 4px 16px ${pA};
}
.opt-btn.correct{background:rgba(0,200,100,0.15);border-color:#00c864;color:#00c864;box-shadow:0 0 16px rgba(0,200,100,0.25);}
.opt-btn.wrong{background:${dA};border-color:var(--clr-d);color:var(--clr-d);}
.opt-btn.dim{opacity:0.25;}
.opt-btn:disabled{cursor:default;}

/* ── HINT ── */
.ghost-btn{background:none;border:1px dashed ${pA};border-radius:8px;padding:8px 16px;
  color:${p}66;font-family:'Nunito',sans-serif;font-size:13px;cursor:pointer;width:100%;transition:all 0.2s;}
.ghost-btn:hover{border-color:var(--clr-p);color:var(--clr-p);}

/* ── FEEDBACK ── */
.feedback-box{border-radius:8px;padding:14px 16px;margin:12px 0 10px;font-size:15px;font-weight:800;}
.fb-correct{background:rgba(0,200,100,0.1);color:#00c864;border:1.5px solid rgba(0,200,100,0.3);}
.fb-wrong{background:${dA};color:var(--clr-d);border:1.5px solid ${d}40;}
.explanation{font-size:12px;font-weight:500;color:#a0c8c0;margin-top:6px;line-height:1.7;opacity:0.9;}

.token-flash{
  display:inline-flex;align-items:center;gap:6px;
  background:${gA};border:1.5px solid ${gB};
  border-radius:6px;padding:5px 14px;
  font-family:'Share Tech Mono',monospace;font-size:13px;font-weight:700;color:var(--clr-g);
  margin-top:8px;animation:token-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
}
@keyframes token-pop{from{transform:scale(0.5);opacity:0}to{transform:scale(1);opacity:1}}

.unlock-ok{background:rgba(0,200,100,0.08);border:1px solid rgba(0,200,100,0.3);border-radius:8px;
  padding:10px 14px;color:#00c864;font-size:13px;font-weight:700;margin:8px 0;}
.unlock-fail{background:${dA};border:1px solid ${d}40;border-radius:8px;
  padding:10px 14px;color:var(--clr-d);font-size:13px;font-weight:700;margin:8px 0;}

/* ── BUTTONS ── */
.pill-btn{
  display:block;width:100%;padding:13px;border:none;border-radius:8px;
  font-family:'Nunito',sans-serif;font-size:15px;font-weight:900;
  cursor:pointer;transition:all 0.2s;margin-top:8px;letter-spacing:0.5px;
}
.btn-primary{background:linear-gradient(135deg,var(--clr-p),${p}aa);color:#001a14;box-shadow:0 0 20px ${pA};}
.btn-primary:hover{filter:brightness(1.15);transform:translateY(-2px);}
.btn-danger{background:linear-gradient(135deg,var(--clr-d),${d}aa);color:#fff;box-shadow:0 0 20px ${dA};}
.btn-danger:hover{filter:brightness(1.15);transform:translateY(-2px);}
.btn-gold{background:linear-gradient(135deg,var(--clr-g),${g}aa);color:#1a1000;box-shadow:0 0 20px ${gA};}
.btn-gold:hover{filter:brightness(1.15);transform:translateY(-2px);}
.btn-cyan{background:linear-gradient(135deg,#00bcd4,#007a8a);color:#001a20;box-shadow:0 0 20px rgba(0,188,212,0.3);}
.btn-cyan:hover{filter:brightness(1.15);transform:translateY(-2px);}
.btn-ghost{background:rgba(255,255,255,0.06);color:#a0c8c0;border:1px solid rgba(255,255,255,0.1);}
.btn-ghost:hover{background:rgba(255,255,255,0.1);}
.pill-btn:active{transform:translateY(0)!important;}

/* ── AI TUTOR PANEL ── */
.tutor-panel{
  margin:14px 14px;background:rgba(0,8,16,0.95);
  border:2px solid ${pB};border-radius:12px;overflow:hidden;
  box-shadow:0 0 30px ${pA}20,inset 0 0 30px ${pA}08;
}
.tutor-header{
  display:flex;align-items:center;gap:12px;padding:12px 16px;
  background:${pA}18;border-bottom:1px solid ${pA};
}
.tutor-avatar{
  width:40px;height:40px;border-radius:6px;flex-shrink:0;
  background:linear-gradient(135deg,#003028,#001a14);
  border:2px solid var(--clr-p);
  display:flex;align-items:center;justify-content:center;font-size:20px;
  box-shadow:0 0 12px ${pA};
}
.tutor-name{font-family:'Creepster',cursive;font-size:16px;color:var(--clr-p);letter-spacing:1px;}
.tutor-status{font-size:10px;color:${p}80;font-family:'Share Tech Mono',monospace;letter-spacing:1px;}
.tutor-online-dot{width:7px;height:7px;border-radius:50%;background:#00c864;box-shadow:0 0 6px #00c864;animation:tutor-pulse 2s ease-in-out infinite;flex-shrink:0;}
@keyframes tutor-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(0.7)}}

.tutor-messages{
  max-height:200px;overflow-y:auto;padding:12px 14px;
  display:flex;flex-direction:column;gap:10px;
  scrollbar-width:thin;scrollbar-color:${pA} transparent;
}
.tutor-messages::-webkit-scrollbar{width:4px}
.tutor-messages::-webkit-scrollbar-thumb{background:${pA};border-radius:2px}

.msg-tutor{display:flex;gap:8px;align-items:flex-start;}
.msg-tutor-text{
  background:${pA}20;border:1px solid ${pA};
  border-radius:0 8px 8px 8px;padding:9px 12px;
  font-size:13px;color:#a8e8d8;line-height:1.55;max-width:90%;font-style:italic;
}
.msg-user{display:flex;justify-content:flex-end;}
.msg-user-text{
  background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
  border-radius:8px 0 8px 8px;padding:9px 12px;
  font-size:13px;color:#c8e0d8;line-height:1.55;max-width:90%;
}
.tutor-typing{display:flex;gap:5px;padding:4px 0;}
.tutor-typing span{width:6px;height:6px;border-radius:50%;background:var(--clr-p);opacity:0.4;}
.tutor-typing span:nth-child(1){animation:dot-bounce 1.2s ease-in-out 0s infinite;}
.tutor-typing span:nth-child(2){animation:dot-bounce 1.2s ease-in-out 0.2s infinite;}
.tutor-typing span:nth-child(3){animation:dot-bounce 1.2s ease-in-out 0.4s infinite;}
@keyframes dot-bounce{0%,60%,100%{transform:translateY(0);opacity:0.4}30%{transform:translateY(-5px);opacity:1}}

.tutor-input-row{display:flex;gap:8px;padding:10px 14px;border-top:1px solid ${pA}40;}
.tutor-input{
  flex:1;background:${pA}10;border:1px solid ${pA};
  border-radius:8px;padding:9px 12px;color:#c8e8e0;
  font-family:'Nunito',sans-serif;font-size:13px;outline:none;
}
.tutor-input:focus{border-color:var(--clr-p);}
.tutor-input::placeholder{color:${p}40;}
.tutor-send{
  background:${pA}30;border:1px solid ${pB};
  border-radius:8px;padding:9px 14px;color:var(--clr-p);
  font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap;transition:all 0.2s;
}
.tutor-send:hover{background:${pA}50;border-color:var(--clr-p);}

/* ── RESULTS ── */
.results-card{text-align:center;padding:28px 20px;}
.results-star{font-size:60px;margin-bottom:12px;animation:star-spin 1s cubic-bezier(0.34,1.56,0.64,1) both;display:block;}
@keyframes star-spin{from{transform:rotate(-180deg) scale(0);opacity:0}to{transform:rotate(0) scale(1);opacity:1}}
.results-title{font-family:'Creepster',cursive;font-size:28px;color:var(--clr-p);margin-bottom:6px;letter-spacing:2px;}
.results-sub{font-size:14px;color:${p}99;margin-bottom:20px;}
.token-total-display{
  display:inline-flex;flex-direction:column;align-items:center;gap:4px;
  background:${gA};border:2px solid ${gB};
  border-radius:12px;padding:16px 28px;margin-bottom:20px;
}
.token-total-big{font-family:'Creepster',cursive;font-size:40px;color:var(--clr-g);letter-spacing:2px;}
.token-total-lbl{font-size:10px;color:${g}99;font-weight:700;letter-spacing:2px;text-transform:uppercase;font-family:'Share Tech Mono',monospace;}
.token-total-earned{font-size:12px;color:${g}bb;font-weight:700;font-family:'Share Tech Mono',monospace;}
.toggle-row{display:flex;justify-content:space-between;align-items:center;
  background:${pA}10;border:1px solid ${pA};border-radius:8px;padding:12px 16px;
  color:#a0c8c0;font-size:13px;font-weight:700;margin-bottom:10px;}
.mini-btn{padding:7px 16px;border:none;border-radius:6px;font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;cursor:pointer;}

/* ── SHOP ── */
.shop-header{display:flex;align-items:center;gap:12px;margin-bottom:6px;}
.shop-title{font-family:'Creepster',cursive;font-size:22px;letter-spacing:2px;color:var(--clr-g);}
.shop-balance{display:flex;align-items:center;gap:5px;background:${gA};border:1px solid ${gB};
  border-radius:6px;padding:4px 12px;font-family:'Share Tech Mono',monospace;font-size:14px;font-weight:700;color:var(--clr-g);}
.shop-sub{font-size:12px;color:${p}80;margin-bottom:16px;}
.shop-rate-box{display:flex;align-items:center;justify-content:center;gap:10px;
  background:${pA}10;border:1px dashed ${pA};border-radius:8px;padding:10px;
  margin-bottom:14px;font-size:12px;color:${p}99;flex-wrap:wrap;}
.shop-rate-box strong{color:var(--clr-g);}
.tier-label{font-size:9px;font-weight:800;letter-spacing:3px;text-transform:uppercase;
  margin:14px 0 8px;font-family:'Share Tech Mono',monospace;}
.tier-bronze{color:#cd7f32;}
.tier-silver{color:#a8bfc0;}
.tier-gold{color:var(--clr-g);}
.shop-item{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.03);
  border:1px solid ${pA}30;border-radius:10px;padding:14px;margin-bottom:8px;transition:all 0.2s;}
.shop-item.can-afford:hover{background:${pA}18;border-color:${pB};transform:translateX(3px);}
.shop-item.cant-afford{opacity:0.45;}
.shop-item-icon{font-size:26px;flex-shrink:0;}
.shop-item-info{flex:1;min-width:0;}
.shop-item-name{font-size:14px;font-weight:800;color:#c8e8e0;}
.shop-item-desc{font-size:11px;color:${p}66;margin-top:2px;}
.shop-item-cost{font-family:'Share Tech Mono',monospace;font-size:14px;font-weight:700;color:var(--clr-g);flex-shrink:0;}
.shop-buy-btn{padding:8px 14px;border:none;border-radius:7px;font-family:'Nunito',sans-serif;
  font-size:11px;font-weight:900;cursor:pointer;transition:all 0.2s;flex-shrink:0;white-space:nowrap;}
.shop-buy-btn.active{background:linear-gradient(135deg,var(--clr-g),${g}aa);color:#1a1000;box-shadow:0 0 15px ${gA};}
.shop-buy-btn.active:hover{filter:brightness(1.1);transform:scale(1.05);}
.shop-buy-btn.locked{background:rgba(255,255,255,0.05);color:${p}50;border:1px solid ${pA};cursor:not-allowed;font-size:10px;}

/* ── MODAL ── */
.modal-overlay{position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);backdrop-filter:blur(6px);}
.modal-box{background:#050f18;border:2px solid ${gB};border-radius:16px;padding:28px 24px;max-width:340px;width:90%;text-align:center;animation:modal-slide 0.3s cubic-bezier(0.34,1.56,0.64,1) both;box-shadow:0 0 60px ${gA};}
@keyframes modal-slide{from{transform:scale(0.85) translateY(20px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}
.modal-icon{font-size:52px;margin-bottom:12px;display:block;}
.modal-title{font-family:'Creepster',cursive;font-size:22px;color:#e8f4f0;margin-bottom:6px;letter-spacing:1px;}
.modal-desc{font-size:13px;color:#80a098;line-height:1.6;margin-bottom:16px;}
.modal-cost{display:inline-flex;align-items:center;gap:6px;background:${gA};border:1px solid ${gB};
  border-radius:6px;padding:6px 16px;font-family:'Share Tech Mono',monospace;font-size:16px;font-weight:700;color:var(--clr-g);margin-bottom:18px;}
.modal-btns{display:flex;gap:10px;}
.modal-confirm{flex:1;padding:12px;border:none;border-radius:8px;background:linear-gradient(135deg,var(--clr-g),${g}aa);
  color:#1a1000;font-family:'Nunito',sans-serif;font-size:14px;font-weight:900;cursor:pointer;}
.modal-cancel{flex:1;padding:12px;border:1px solid ${pA};border-radius:8px;background:${pA}10;
  color:#60a090;font-family:'Nunito',sans-serif;font-size:14px;font-weight:700;cursor:pointer;}

/* ── SUCCESS ── */
.success-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);}
.success-box{text-align:center;padding:36px 28px;max-width:360px;width:90%;background:#050f18;
  border:2px solid ${gB};border-radius:20px;box-shadow:0 0 80px ${gA};animation:modal-slide 0.4s cubic-bezier(0.34,1.56,0.64,1) both;}
.success-icon{font-size:68px;animation:star-spin 0.6s cubic-bezier(0.34,1.56,0.64,1) both;display:block;margin-bottom:14px;}
.success-title{font-family:'Creepster',cursive;font-size:26px;color:var(--clr-g);margin-bottom:8px;letter-spacing:2px;}
.success-desc{font-size:14px;color:#80a098;line-height:1.7;margin-bottom:20px;}
.success-close{padding:12px 32px;border:none;border-radius:8px;background:linear-gradient(135deg,var(--clr-p),${p}aa);
  color:#001a14;font-family:'Nunito',sans-serif;font-size:14px;font-weight:900;cursor:pointer;}

/* ── LOADING ── */
.loading-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:16px;}
.spinner{width:44px;height:44px;border:3px solid ${pA};border-top-color:var(--clr-p);border-radius:50%;animation:spin 0.8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-title{font-family:'Creepster',cursive;font-size:20px;color:var(--clr-p);letter-spacing:2px;}
.loading-sub{font-size:13px;color:${p}80;text-align:center;font-family:'Share Tech Mono',monospace;}

/* ── EXTRAS / HISTORY ── */
.extra-banner{display:flex;align-items:center;gap:8px;padding:8px 18px 4px;font-size:10px;font-weight:800;
  color:rgba(0,188,212,0.7);font-family:'Share Tech Mono',monospace;letter-spacing:1px;text-transform:uppercase;}
.extra-banner span{color:rgba(0,188,212,0.4);font-weight:400;}
.history-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;
  margin-bottom:4px;background:${pA}08;font-size:12px;}
.history-correct{border-left:3px solid #00c864;}
.history-wrong{border-left:3px solid var(--clr-d);}
.history-extra{border-left:3px solid #00bcd4;}
.h-topic{color:var(--clr-p);font-weight:700;font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:1px;}
.h-tokens{margin-left:auto;font-family:'Share Tech Mono',monospace;color:var(--clr-g);font-weight:700;font-size:11px;}
.bal-bar{display:flex;align-items:center;gap:8px;padding:4px 16px 0;font-size:12px;color:${p}66;}
.bal-bar strong{color:var(--clr-g);}
`;
}

// ── TUTOR SYSTEM PROMPT BUILDER ──────────────────────────────────────────────

function buildTutorSystemPrompt(cfg, currentQuestion) {
  const name       = cfg.child_name   || "the student";
  const age        = cfg.child_age    || 9;
  const schoolYear = cfg.school_year  || "Year 4";
  const mathsLevel = cfg.maths_level  || "Year 3";
  const tutorName  = cfg.tutor_name   || "Aria";

  const questionCtx = currentQuestion
    ? `The current question is: "${currentQuestion.question}". The answer is "${currentQuestion.answer}" but you must NOT reveal it.`
    : "There is no active question right now — you can offer general encouragement.";

  return `You are ${tutorName} — a friendly, encouraging AI maths tutor.
You are helping ${name} (age ${age}, ${schoolYear}, working at ${mathsLevel} maths level).

CRITICAL RULES:
1. NEVER give the direct answer to the current question. If asked, refuse kindly but firmly.
2. Instead, guide with hints, simpler related examples, step-by-step thinking, or encouragement.
3. Keep all responses SHORT — 2 to 4 sentences maximum. You are on a small mobile screen.
4. Use simple, age-appropriate language.
5. You may use 1 or 2 emoji per message to be friendly and warm.
6. If ${name} seems frustrated or stuck, be extra warm and encouraging.
7. Always be kind, safe, and positive.
8. You may explain the concept behind the topic — just never the specific answer.

${questionCtx}

Speak as ${tutorName}: brief, warm, encouraging, and always helpful.`;
}

// ── TUTOR GREETINGS ───────────────────────────────────────────────────────────

function getTutorGreetings(tutorName) {
  return [
    `Hi! I'm ${tutorName}. I'm here to help you think — but I'll never just give you the answer. You've got this! 🌟`,
    `Hello! ${tutorName} here. Every great mathematician started exactly where you are. Let's think this through together. ✨`,
    `${tutorName} online! I'm here to guide you — but the clever thinking has to be yours. Ask me anything! 🤔`,
    `Hey there! I'm ${tutorName}. I believe in you completely. Don't be afraid to try — mistakes help us learn! 💚`,
    `${tutorName} ready! I know you can figure this out. I'll give hints, but the brilliant brain here is yours. 🧠`,
  ];
}

// ── QUESTION TOPICS ───────────────────────────────────────────────────────────

function buildQuestionPrompt(cfg, weakList, usedQuestions, count, isExtra) {
  const name       = cfg.child_name   || "the student";
  const age        = cfg.child_age    || 9;
  const schoolYear = cfg.school_year  || "Year 4";
  const mathsLevel = cfg.maths_level  || "Year 3";
  const focusTip   = weakList.length
    ? `Focus on weak areas: ${weakList.join(", ")}.`
    : "Cover a broad range of topics.";
  const avoidStr   = usedQuestions?.length ? `Avoid repeating these questions: ${usedQuestions.join("; ")}.` : "";

  if (isExtra) {
    return `You are a kind maths teacher for ${name}, age ${age}, ${schoolYear} (working at ${mathsLevel} level). ${focusTip} ${avoidStr}

Generate 1 maths question as a JSON object (NOT an array). Vary difficulty 1–3.

Each question MUST have:
- "question": string (friendly, include an emoji)
- "options": array of exactly 4 strings
- "answer": string (must exactly match one option)
- "hint": string (helpful, max 20 words, NO direct answer)
- "explanation": string (warm, 2–3 sentences, shown after answering)
- "topic": one of [${TOPICS.join(",")}]
- "difficulty": integer 1, 2, or 3  (1=easy, 2=normal, 3=hard)

Return ONLY valid JSON. No markdown, no preamble.`;
  }

  return `You are a kind maths teacher for ${name}, age ${age}, ${schoolYear} (working at ${mathsLevel} level). ${focusTip}

Generate exactly ${count} maths questions as a JSON array. Question 1 is the mandatory daily question. Questions 2–${count} are bonus questions.

Difficulty guide:
- 1 (Easy, 0.5 tokens): single-step, basic number bonds, simple +/−
- 2 (Normal, 1 token): multi-step, multiplication/division, fractions
- 3 (Hard, 2 tokens): challenging reasoning, multi-step, geometry or word problems

Each question MUST have:
- "question": string (friendly, include an emoji)
- "options": array of exactly 4 strings
- "answer": string (must exactly match one option)
- "hint": string (helpful, max 20 words, NO direct answer)
- "explanation": string (warm, 2–3 sentences, shown after answering)
- "topic": one of [${TOPICS.join(",")}]
- "difficulty": integer 1, 2, or 3

Return ONLY a valid JSON array. No markdown, no preamble.`;
}

// ── CARD COMPONENT ────────────────────────────────────────────────────────────

class KidsMathsDashboard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode:"open" });
    this._hass      = null;
    this._cfg       = {};
    this._ui        = null;
    this._st        = null;
    this._activeTab = "quiz";
    this._tutorMsgs = [];
    this._tutorBusy = false;
  }

  // ── LOVELACE HOOKS ────────────────────────────────────────────────────────

  setConfig(c) {
    this._cfg = {
      // Entity IDs
      openai_key_entity:    c.openai_key_entity    || "input_text.kids_maths_openai_key",
      internet_entity:      c.internet_entity      || "input_boolean.kids_maths_internet",
      weak_topics_entity:   c.weak_topics_entity   || "input_text.kids_maths_weak_topics",
      cache_entity:         c.cache_entity         || "input_text.kids_maths_question_cache",
      tokens_entity:        c.tokens_entity        || "input_text.kids_maths_token_balance",
      // Personalisation
      child_name:           c.child_name           || "Alex",
      child_age:            c.child_age            || 9,
      school_year:          c.school_year          || "Year 4",
      maths_level:          c.maths_level          || "Year 3",
      tutor_name:           c.tutor_name           || "Aria",
      tutor_avatar:         c.tutor_avatar         || "🤖",
      // Theme
      theme_primary:        c.theme_primary        || "#00c8a0",
      theme_danger:         c.theme_danger         || "#ff3355",
      theme_gold:           c.theme_gold           || "#ffc800",
      theme_bg:             c.theme_bg             || "#07111a",
      // Shop — use config items if provided, else defaults
      shop_items:           Array.isArray(c.shop_items) && c.shop_items.length
                              ? c.shop_items
                              : DEFAULT_SHOP_ITEMS,
    };
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._ui) this._boot();
    else this._syncTopbar();
  }

  // ── BOOT ──────────────────────────────────────────────────────────────────

  async _boot() {
    this._loadState();
    this._mount();
    const today = new Date().toDateString();
    if (this._st.date !== today || !this._st.mandatory) {
      await this._fetchDailyQuestions(today);
    } else {
      this._renderFull();
    }
  }

  // ── STATE ─────────────────────────────────────────────────────────────────

  _storageKey() {
    // Namespace by child name so multiple children can share a browser
    const n = (this._cfg.child_name || "default").toLowerCase().replace(/[^a-z0-9]/g,"_");
    return `kids_maths_v1_${n}`;
  }

  _loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(this._storageKey()) || "{}");
      if (raw.date === new Date().toDateString()) {
        this._st = raw;
        if (!this._st.sessionTokensEarned) this._st.sessionTokensEarned = 0;
        return;
      }
    } catch(_) {}
    this._st = this._freshState();
  }

  _freshState() {
    return {
      date:               new Date().toDateString(),
      phase:              "loading",
      mandatory:          null,
      bonus:              [],
      bonusIdx:           0,
      mandatoryDone:      false,
      mandatoryCorrect:   false,
      chosen:             null,
      hintShown:          false,
      sessionTokensEarned:0,
      extraQuestion:      null,
      history:            [],
    };
  }

  _save() {
    try { localStorage.setItem(this._storageKey(), JSON.stringify(this._st)); } catch(_) {}
  }

  // ── TOKEN BANK ────────────────────────────────────────────────────────────

  _tokenKey() {
    const n = (this._cfg.child_name || "default").toLowerCase().replace(/[^a-z0-9]/g,"_");
    return `kids_maths_tokens_${n}`;
  }

  _getTokenBalance() {
    const v = parseFloat(localStorage.getItem(this._tokenKey()) || "0");
    return isNaN(v) ? 0 : v;
  }
  _setTokenBalance(v) {
    const r = Math.round(Math.max(0, v) * 10) / 10;
    localStorage.setItem(this._tokenKey(), String(r));
    this._haSet(this._cfg.tokens_entity, String(r));
  }
  _addTokens(a)  { this._setTokenBalance(this._getTokenBalance() + a); }
  _spendTokens(a){
    if (this._getTokenBalance() < a) return false;
    this._setTokenBalance(this._getTokenBalance() - a);
    return true;
  }
  _fmt(v) { return v % 1 === 0 ? String(v) : v.toFixed(1); }

  // ── PURCHASES ─────────────────────────────────────────────────────────────

  _purchaseKey() {
    const n = (this._cfg.child_name || "default").toLowerCase().replace(/[^a-z0-9]/g,"_");
    return `kids_maths_purchases_${n}`;
  }
  _getPurchases() {
    try { return JSON.parse(localStorage.getItem(this._purchaseKey()) || "[]"); } catch(_) { return []; }
  }
  _addPurchase(item) {
    const list = this._getPurchases();
    list.unshift({ ...item, date: new Date().toLocaleDateString("en-GB"), ts: Date.now() });
    localStorage.setItem(this._purchaseKey(), JSON.stringify(list.slice(0,50)));
  }

  // ── OPENAI API ────────────────────────────────────────────────────────────

  _apiKey() {
    return this._hass?.states[this._cfg.openai_key_entity]?.state?.trim() || "";
  }
  _weakTopics() {
    try { return JSON.parse(this._hass?.states[this._cfg.weak_topics_entity]?.state || "{}"); }
    catch(_) { return {}; }
  }

  async _gpt(messages, max_tokens = 1000) {
    const key = this._apiKey();
    if (!key || key === "unknown") {
      throw new Error(`No API key found. Set your OpenAI key in entity: ${this._cfg.openai_key_entity}`);
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({ model:"gpt-4o", max_tokens, messages }),
    });
    if (!res.ok) {
      const e = await res.json().catch(()=>({}));
      throw new Error(e.error?.message || `HTTP ${res.status}`);
    }
    return (await res.json()).choices[0].message.content.trim();
  }

  // ── FETCH DAILY QUESTIONS ─────────────────────────────────────────────────

  async _fetchDailyQuestions(today) {
    this._st.phase = "loading";
    this._renderPhase();

    const weak     = this._weakTopics();
    const weakList = Object.entries(weak).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]);
    const prompt   = buildQuestionPrompt(this._cfg, weakList, [], 6, false);

    try {
      const raw       = await this._gpt([{role:"user", content:prompt}], 1600);
      const questions = JSON.parse(raw.replace(/```json|```/g,"").trim());

      this._st           = this._freshState();
      this._st.date      = today;
      this._st.mandatory = questions[0];
      this._st.bonus     = questions.slice(1, 6);
      this._st.phase     = "mandatory";
      this._save();

      this._haSet(this._cfg.cache_entity, `${today}|${questions[0].topic}`);

      // Greet with tutor
      const greetings = getTutorGreetings(this._cfg.tutor_name || "Aria");
      this._tutorMsgs = [{
        role:"tutor",
        text: greetings[Math.floor(Math.random() * greetings.length)],
      }];
    } catch(e) {
      this._st.phase = "error";
      this._st.error = e.message;
      this._save();
    }
    this._renderFull();
  }

  // ── FETCH EXTRA QUESTION ──────────────────────────────────────────────────

  async _fetchExtraQuestion() {
    this._st.phase         = "extra";
    this._st.chosen        = null;
    this._st.hintShown     = false;
    this._st.extraQuestion = null;
    this._save();

    this._setContent(`
      <div class="extra-banner">★ EXTRA PRACTICE <span>— half tokens per correct answer</span></div>
      <div class="loading-wrap">
        <div class="spinner"></div>
        <div class="loading-title">LOADING QUESTION</div>
        <div class="loading-sub">Your tutor is selecting the next question...</div>
      </div>`);

    const weak      = this._weakTopics();
    const weakList  = Object.entries(weak).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]);
    const usedQs    = [
      this._st.mandatory?.question,
      ...(this._st.bonus||[]).map(q=>q.question),
    ].filter(Boolean);
    const prompt    = buildQuestionPrompt(this._cfg, weakList, usedQs, 1, true);

    try {
      const raw = await this._gpt([{role:"user", content:prompt}], 700);
      const q   = JSON.parse(raw.replace(/```json|```/g,"").trim());
      this._st.extraQuestion = q;
      this._save();
      this._renderPhase();
    } catch(e) {
      this._st.phase = "results";
      this._save();
      this._renderPhase();
    }
  }

  // ── ANSWER HANDLING ───────────────────────────────────────────────────────

  _currentQuestion() {
    const p = this._st.phase;
    if (p === "mandatory") return this._st.mandatory;
    if (p === "bonus")     return this._st.bonus[this._st.bonusIdx];
    if (p === "extra")     return this._st.extraQuestion || null;
    return null;
  }

  _pick(val) {
    if (this._st.chosen) return;
    const q       = this._currentQuestion();
    const correct = val === q.answer;
    this._st.chosen = val;

    // Update weak topic tracking
    const weak = this._weakTopics();
    if (!correct) {
      weak[q.topic] = (weak[q.topic] || 0) + 1;
    } else if (weak[q.topic] > 0) {
      weak[q.topic] = Math.max(0, (weak[q.topic] || 0) - 0.5);
    }
    this._haSet(this._cfg.weak_topics_entity, JSON.stringify(weak));

    // Token reward
    const diff         = q.difficulty || 2;
    const base         = DIFFICULTY_TOKENS[diff] || 1;
    const isExtra      = this._st.phase === "extra";
    const tokensEarned = correct ? (isExtra ? base * 0.5 : base) : 0;
    if (correct) {
      this._addTokens(tokensEarned);
      this._st.sessionTokensEarned = (this._st.sessionTokensEarned || 0) + tokensEarned;
    }

    // History
    this._st.history = this._st.history || [];
    this._st.history.unshift({
      topic: q.topic, correct, tokens: tokensEarned,
      question: q.question, diff, extra: isExtra,
    });

    // Mandatory internet reward
    if (this._st.phase === "mandatory") {
      this._st.mandatoryCorrect = correct;
      this._st.mandatoryDone   = true;
      if (correct) this._toggleInternet(true);
    }

    // Tutor reacts
    const name = this._cfg.child_name || "you";
    if (correct) {
      const praises = [
        `Excellent! I knew you could work that out, ${name}! 🎉`,
        `Correct! That's brilliant thinking — well done! ✨`,
        `Yes! You should feel really proud of that one! 🌟`,
        `Amazing work! Every correct answer is making you stronger. 💚`,
      ];
      this._tutorMsgs.push({role:"tutor", text: praises[Math.floor(Math.random()*praises.length)]});
    } else {
      const encouragements = [
        `The answer was ${q.answer}. Mistakes are how we learn — don't stop now! 💙`,
        `Not this time — the correct answer was ${q.answer}. You tried, and that matters! 🤔`,
        `The right answer was ${q.answer}. Let's think about why together next time. 💙`,
      ];
      this._tutorMsgs.push({role:"tutor", text: encouragements[Math.floor(Math.random()*encouragements.length)]});
    }

    this._save();
    this._renderPhase();
  }

  _advance() {
    const s = this._st;
    if (s.phase === "mandatory") {
      s.phase = "bonus"; s.bonusIdx = 0;
      s.chosen = null; s.hintShown = false;
      this._save(); this._renderPhase();
    } else if (s.phase === "bonus") {
      if (s.bonusIdx + 1 < s.bonus.length) {
        s.bonusIdx++; s.chosen = null; s.hintShown = false;
        this._save(); this._renderPhase();
      } else {
        s.phase = "results"; this._save(); this._renderPhase();
      }
    } else if (s.phase === "extra") {
      this._fetchExtraQuestion();
    }
  }

  _showHint() {
    this._st.hintShown = true;
    const q = this._currentQuestion();
    if (q?.hint) {
      this._tutorMsgs.push({
        role:"tutor",
        text: `Here's a clue — but the thinking is still yours: "${q.hint}" 🔍`,
      });
    }
    this._save();
    this._renderPhase();
    setTimeout(() => this._scrollTutor(), 200);
  }

  _toggleInternet(on) {
    if (!this._hass) return;
    this._hass.callService("input_boolean", on ? "turn_on" : "turn_off",
      { entity_id: this._cfg.internet_entity });
  }
  _haSet(entity, value) {
    if (!this._hass || !entity) return;
    this._hass.callService("input_text", "set_value",
      { entity_id: entity, value: String(value).slice(0, 255) });
  }

  // ── TUTOR CHAT ────────────────────────────────────────────────────────────

  async _askTutor(userMsg) {
    if (!userMsg.trim() || this._tutorBusy) return;
    this._tutorMsgs.push({ role:"user", text: userMsg });
    this._tutorBusy = true;
    this._renderTutorMessages();

    const systemPrompt = buildTutorSystemPrompt(this._cfg, this._currentQuestion());

    try {
      const messages = [
        { role:"system", content: systemPrompt },
        ...this._tutorMsgs.slice(-8).map(m => ({
          role:    m.role === "tutor" ? "assistant" : "user",
          content: m.text,
        })),
      ];
      const reply = await this._gpt(messages, 200);
      this._tutorMsgs.push({ role:"tutor", text: reply });
    } catch(e) {
      this._tutorMsgs.push({ role:"tutor", text:"My connection wobbled — try again in a moment! 🔵" });
    }
    this._tutorBusy = false;
    this._renderTutorMessages();
    this._scrollTutor();
  }

  _renderTutorMessages() {
    const wrap = this.shadowRoot.querySelector("#tutor-messages");
    if (!wrap) return;
    let html = "";
    this._tutorMsgs.slice(-12).forEach(m => {
      if (m.role === "tutor") {
        html += `<div class="msg-tutor"><div class="msg-tutor-text">${this._esc(m.text)}</div></div>`;
      } else {
        html += `<div class="msg-user"><div class="msg-user-text">${this._esc(m.text)}</div></div>`;
      }
    });
    if (this._tutorBusy) {
      html += `<div class="msg-tutor"><div class="msg-tutor-text"><div class="tutor-typing"><span></span><span></span><span></span></div></div></div>`;
    }
    wrap.innerHTML = html;
    this._scrollTutor();
  }

  _scrollTutor() {
    setTimeout(() => {
      const w = this.shadowRoot.querySelector("#tutor-messages");
      if (w) w.scrollTop = w.scrollHeight;
    }, 50);
  }

  _sendTutor() {
    const inp = this.shadowRoot.querySelector("#tutor-input");
    const msg = inp?.value?.trim();
    if (!msg) return;
    inp.value = "";
    this._askTutor(msg);
  }

  _buildTutorPanel() {
    const tutorName   = this._cfg.tutor_name   || "Aria";
    const tutorAvatar = this._cfg.tutor_avatar || "🤖";
    return `
      <div class="tutor-panel">
        <div class="tutor-header">
          <div class="tutor-avatar">${tutorAvatar}</div>
          <div style="flex:1">
            <div class="tutor-name">${tutorName.toUpperCase()}</div>
            <div class="tutor-status">GUIDANCE SYSTEM ONLINE</div>
          </div>
          <div class="tutor-online-dot"></div>
        </div>
        <div class="tutor-messages" id="tutor-messages"></div>
        <div class="tutor-input-row">
          <input class="tutor-input" id="tutor-input" placeholder="Ask ${tutorName} for help... (never the answer)" />
          <button class="tutor-send" id="tutor-send">SEND</button>
        </div>
      </div>`;
  }

  _wireTutor() {
    const inp = this.shadowRoot.querySelector("#tutor-input");
    const btn = this.shadowRoot.querySelector("#tutor-send");
    inp?.addEventListener("keydown", e => { if (e.key === "Enter") this._sendTutor(); });
    btn?.addEventListener("click",   () => this._sendTutor());
    this._renderTutorMessages();
  }

  // ── DOM SETUP ─────────────────────────────────────────────────────────────

  _mount() {
    const name = this._cfg.child_name || "Alex";
    const marqueeText = [
      `* ${name.toUpperCase()}'S MATHS CHALLENGE`,
      "* EARN TOKENS",
      "* HARDER QUESTIONS = MORE TOKENS",
      "* YOUR TUTOR IS READY",
      "* NEVER STOP LEARNING",
      "* YOU ARE CAPABLE OF EVERYTHING",
    ].join(" ");

    this.shadowRoot.innerHTML = `<style>${buildCSS(this._cfg)}</style>
<div class="shell">
  <div id="topbar"></div>
  <div class="marquee-wrap"><span class="marquee-inner">${marqueeText}</span></div>
  <div id="nav-tabs" class="nav-tabs"></div>
  <div id="content"></div>
</div>`;
    this._ui = this.shadowRoot.querySelector(".shell");
    this._renderTopbar();
    this._renderNavTabs();
  }

  _renderTopbar() {
    const internetOn = this._hass?.states[this._cfg.internet_entity]?.state === "on";
    const balance    = this._getTokenBalance();
    const name       = this._cfg.child_name || "Alex";
    const tb         = this.shadowRoot.querySelector("#topbar");
    if (!tb) return;
    tb.innerHTML = `
      <div class="topbar">
        <div class="logo">${name}'s <span>Maths</span></div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="token-hud" id="token-hud-btn">
            <span style="font-size:14px">🪙</span>
            <span class="token-hud-val">${this._fmt(balance)}</span>
            <span class="token-hud-label">Tokens</span>
          </div>
          <div class="inet-badge ${internetOn?"on":"off"}" id="inet-badge">${internetOn?"NET: ON":"NET: OFF"}</div>
        </div>
      </div>`;
    tb.querySelector("#token-hud-btn")?.addEventListener("click", () => {
      this._activeTab = "shop";
      this._renderNavTabs();
      this._renderContent();
    });
  }

  _syncTopbar() {
    const internetOn = this._hass?.states[this._cfg.internet_entity]?.state === "on";
    const badge = this.shadowRoot.querySelector("#inet-badge");
    if (badge) {
      badge.className   = `inet-badge ${internetOn?"on":"off"}`;
      badge.textContent = internetOn ? "NET: ON" : "NET: OFF";
    }
    const bal = this.shadowRoot.querySelector(".token-hud-val");
    if (bal) bal.textContent = this._fmt(this._getTokenBalance());
  }

  _renderNavTabs() {
    const nav = this.shadowRoot.querySelector("#nav-tabs");
    if (!nav) return;
    nav.innerHTML = `
      <button class="nav-tab ${this._activeTab==="quiz"?"active":""}" id="tab-quiz">[ QUIZ ]</button>
      <button class="nav-tab ${this._activeTab==="shop"?"active":""}" id="tab-shop">[ SHOP ]</button>
      <button class="nav-tab ${this._activeTab==="history"?"active":""}" id="tab-history">[ HISTORY ]</button>`;
    nav.querySelector("#tab-quiz").onclick    = () => { this._activeTab="quiz";    this._renderNavTabs(); this._renderContent(); };
    nav.querySelector("#tab-shop").onclick    = () => { this._activeTab="shop";    this._renderNavTabs(); this._renderContent(); };
    nav.querySelector("#tab-history").onclick = () => { this._activeTab="history"; this._renderNavTabs(); this._renderContent(); };
  }

  _renderFull()    { this._renderTopbar(); this._renderNavTabs(); this._renderContent(); }
  _renderContent() {
    if      (this._activeTab === "quiz")    this._renderPhase();
    else if (this._activeTab === "shop")    this._renderShop();
    else if (this._activeTab === "history") this._renderHistory();
  }

  _renderPhase() {
    if (this._activeTab !== "quiz") return;
    const p = this._st?.phase;
    if      (p === "loading")   this._renderLoading();
    else if (p === "error")     this._renderError();
    else if (p === "mandatory") this._renderQuestion(true);
    else if (p === "bonus")     this._renderQuestion(false);
    else if (p === "extra")     this._renderExtraQuestion();
    else if (p === "results")   this._renderResults();
  }

  _setContent(html) {
    const c = this.shadowRoot.querySelector("#content");
    if (c) c.innerHTML = html;
  }

  _renderLoading() {
    this._setContent(`
      <div class="loading-wrap">
        <div class="spinner"></div>
        <div class="loading-title">INITIALISING</div>
        <div class="loading-sub">Your tutor is preparing today's questions...</div>
      </div>`);
  }

  _renderError() {
    this._setContent(`
      <div class="card card-danger" style="text-align:center;padding:30px">
        <div style="font-size:36px;margin-bottom:12px">⚠️</div>
        <div style="font-family:'Creepster',cursive;font-size:20px;color:var(--clr-d);margin-bottom:8px;letter-spacing:1px;">ERROR DETECTED</div>
        <div style="font-size:12px;color:var(--clr-d);margin-bottom:12px;font-family:'Share Tech Mono',monospace;opacity:0.8;">${this._st.error || "Unknown error"}</div>
        <div style="font-size:11px;color:var(--clr-p);margin-bottom:18px;font-family:'Share Tech Mono',monospace;opacity:0.5;">
          Check entity: ${this._cfg.openai_key_entity}
        </div>
        <button class="pill-btn btn-primary" id="retry-btn">[ RETRY ]</button>
      </div>`);
    this.shadowRoot.querySelector("#retry-btn")?.addEventListener("click",
      () => this._fetchDailyQuestions(new Date().toDateString()));
  }

  // ── QUESTION (MANDATORY + BONUS) ──────────────────────────────────────────

  _renderQuestion(isMandatory) {
    const q = this._currentQuestion();
    if (!q) { this._renderResults(); return; }
    const s          = this._st;
    const answered   = !!s.chosen;
    const correct    = answered && s.chosen === q.answer;
    const diff       = q.difficulty || 2;
    const tokensFor  = DIFFICULTY_TOKENS[diff] || 1;
    const tStr       = this._fmt(tokensFor);
    const diffLabel  = {1:"EASY",2:"NORMAL",3:"HARD"}[diff] || "NORMAL";
    const name       = this._cfg.child_name || "you";

    const totalSteps  = 1 + (s.bonus?.length || 0);
    const currentStep = isMandatory ? 0 : 1 + (s.bonusIdx || 0);
    const dots        = Array.from({length: totalSteps}, (_, i) =>
      `<div class="dot${i < currentStep ? " done" : i === currentStep ? " active" : ""}"></div>`
    ).join("");
    const stepLabel   = isMandatory ? "★ DAILY QUESTION" : `★ BONUS ${(s.bonusIdx||0)+1} / ${s.bonus.length}`;

    const optBtns = q.options.map(o => {
      let cls = "opt-btn";
      if (answered) {
        if (o === q.answer) cls += " correct";
        else if (o === s.chosen) cls += " wrong";
        else cls += " dim";
      }
      return `<button class="${cls}" data-val="${this._esc(o)}" ${answered?"disabled":""}>${this._esc(o)}</button>`;
    }).join("");

    const feedbackHtml = answered ? `
      <div class="feedback-box ${correct?"fb-correct":"fb-wrong"}">
        ${correct ? `CORRECT! Well done, ${name}!` : `NOT QUITE. The answer was: ${this._esc(q.answer)}`}
        <div class="explanation">${this._esc(q.explanation)}</div>
      </div>
      ${correct
        ? `<div class="token-flash">🪙 +${tStr} TOKEN${tokensFor!==1?"S":""} EARNED</div>`
        : `<div style="font-size:12px;color:var(--clr-p);margin-top:8px;font-family:'Share Tech Mono',monospace;opacity:0.5;">No tokens this time — keep going! 💙</div>`}
      ${isMandatory && correct  ? `<div class="unlock-ok" style="margin-top:10px;">[ INTERNET UNLOCKED ] Great work! Now try the bonus questions for more tokens!</div>` : ""}
      ${isMandatory && !correct ? `<div class="unlock-fail" style="margin-top:10px;">[ NOT UNLOCKED ] Ask a grown-up to unlock internet. Try bonus questions for tokens!</div>` : ""}
      <button class="pill-btn btn-primary next-btn" style="margin-top:12px;">${this._nextLabel(isMandatory, s.bonusIdx, s.bonus.length)}</button>
    ` : `
      ${!s.hintShown ? `<button class="ghost-btn hint-btn">[ REQUEST A HINT ]</button>` : ""}
    `;

    const balance = this._getTokenBalance();
    this._setContent(`
      <div class="progress-row">
        <div class="dots">${dots}</div>
        <div class="step-label">${stepLabel}</div>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
          <span class="topic-pill">${this._esc(q.topic)}</span>
          <span class="diff-badge d${diff}">${diffLabel}</span>
          <span class="token-preview" style="margin-left:4px;">→ 🪙 ${tStr} if correct</span>
        </div>
        <div class="question-text">${this._esc(q.question)}</div>
        ${s.hintShown ? `<div style="background:var(--clr-p)10;border:1px solid var(--clr-p)33;border-radius:8px;padding:10px 14px;color:#80c8b8;font-size:13px;font-weight:600;margin-bottom:14px;font-style:italic;">Hint: "${this._esc(q.hint)}"</div>` : ""}
        <div class="opts-grid">${optBtns}</div>
        ${feedbackHtml}
      </div>
      ${this._buildTutorPanel()}
      <div class="bal-bar">
        <span>🪙 Balance: <strong>${this._fmt(balance)}</strong></span>
        <span style="margin-left:auto;font-size:11px;">Today: <strong>+${this._fmt(s.sessionTokensEarned||0)}</strong></span>
      </div>`);

    const c = this.shadowRoot.querySelector("#content");
    c.querySelectorAll(".opt-btn:not([disabled])").forEach(b =>
      b.addEventListener("click", () => this._pick(b.dataset.val)));
    c.querySelector(".hint-btn")?.addEventListener("click", () => this._showHint());
    c.querySelector(".next-btn")?.addEventListener("click", () => this._advance());
    this._wireTutor();
  }

  _nextLabel(isMandatory, idx, total) {
    if (isMandatory) return "[ BEGIN BONUS QUESTIONS ]";
    if (idx + 1 < total) return "[ NEXT QUESTION ]";
    return "[ VIEW RESULTS ]";
  }

  // ── EXTRA QUESTION ────────────────────────────────────────────────────────

  _renderExtraQuestion() {
    const q = this._st.extraQuestion;
    if (!q) return;
    const s         = this._st;
    const answered  = !!s.chosen;
    const correct   = answered && s.chosen === q.answer;
    const diff      = q.difficulty || 2;
    const tokensFor = (DIFFICULTY_TOKENS[diff] || 1) * 0.5;
    const tStr      = this._fmt(tokensFor);
    const diffLabel = {1:"EASY",2:"NORMAL",3:"HARD"}[diff] || "NORMAL";
    const balance   = this._getTokenBalance();

    const optBtns = q.options.map(o => {
      let cls = "opt-btn";
      if (answered) {
        if (o === q.answer) cls += " correct";
        else if (o === s.chosen) cls += " wrong";
        else cls += " dim";
      }
      return `<button class="${cls}" data-val="${this._esc(o)}" ${answered?"disabled":""}>${this._esc(o)}</button>`;
    }).join("");

    const feedbackHtml = answered ? `
      <div class="feedback-box ${correct?"fb-correct":"fb-wrong"}">
        ${correct ? "CORRECT! Your tutor is pleased!" : `NOT QUITE. The answer was: ${this._esc(q.answer)}`}
        <div class="explanation">${this._esc(q.explanation)}</div>
      </div>
      ${correct
        ? `<div class="token-flash">🪙 +${tStr} TOKEN${tokensFor!==1?"S":""} <span style="font-size:10px;opacity:0.6">(half rate)</span></div>`
        : `<div style="font-size:12px;color:var(--clr-p);margin-top:8px;font-family:'Share Tech Mono',monospace;opacity:0.5;">No tokens — but the practice is the reward! 💙</div>`}
      <div style="display:flex;gap:10px;margin-top:12px;">
        <button class="pill-btn btn-cyan next-btn" style="flex:2;margin-top:0;">[ ANOTHER QUESTION ]</button>
        <button class="pill-btn btn-ghost results-btn" style="flex:1;margin-top:0;">[ RESULTS ]</button>
      </div>
    ` : `
      ${!s.hintShown ? `<button class="ghost-btn hint-btn">[ REQUEST A HINT ]</button>` : ""}
      <div style="margin-top:10px;">
        <button class="pill-btn btn-ghost results-btn">[ SEE RESULTS ]</button>
      </div>
    `;

    this._setContent(`
      <div class="extra-banner">★ EXTRA PRACTICE MODE <span>— half tokens per correct answer</span></div>
      <div class="card">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
          <span class="topic-pill">${this._esc(q.topic)}</span>
          <span class="diff-badge d${diff}">${diffLabel}</span>
          <span class="token-preview" style="margin-left:4px;">→ 🪙 ${tStr} if correct</span>
        </div>
        <div class="question-text">${this._esc(q.question)}</div>
        ${s.hintShown ? `<div style="background:var(--clr-p)10;border:1px solid var(--clr-p)33;border-radius:8px;padding:10px 14px;color:#80c8b8;font-size:13px;font-weight:600;margin-bottom:14px;font-style:italic;">Hint: "${this._esc(q.hint)}"</div>` : ""}
        <div class="opts-grid">${optBtns}</div>
        ${feedbackHtml}
      </div>
      ${this._buildTutorPanel()}
      <div class="bal-bar">
        <span>🪙 Balance: <strong>${this._fmt(balance)}</strong></span>
        <span style="margin-left:auto;font-size:11px;">Today: <strong>+${this._fmt(s.sessionTokensEarned||0)}</strong></span>
      </div>`);

    const c = this.shadowRoot.querySelector("#content");
    c.querySelectorAll(".opt-btn:not([disabled])").forEach(b =>
      b.addEventListener("click", () => this._pick(b.dataset.val)));
    c.querySelector(".hint-btn")?.addEventListener("click",  () => this._showHint());
    c.querySelector(".next-btn")?.addEventListener("click",  () => this._fetchExtraQuestion());
    c.querySelectorAll(".results-btn").forEach(b =>
      b.addEventListener("click", () => {this._st.phase="results"; this._save(); this._renderPhase();}));
    this._wireTutor();
  }

  // ── RESULTS ───────────────────────────────────────────────────────────────

  _renderResults() {
    const s            = this._st;
    const internetOn   = this._hass?.states[this._cfg.internet_entity]?.state === "on";
    const balance      = this._getTokenBalance();
    const earned       = s.sessionTokensEarned || 0;
    const correctCount = (s.history || []).filter(h => h.correct).length;
    const totalCount   = Math.min((s.history || []).length, 6);
    const name         = this._cfg.child_name || "you";
    const greetings    = getTutorGreetings(this._cfg.tutor_name || "Aria");

    this._setContent(`
      <div class="card results-card">
        <div class="results-star">🌟</div>
        <div class="results-title">MISSION COMPLETE</div>
        <div class="results-sub">${correctCount} / ${totalCount} correct — great work, ${name}!</div>
        <div class="token-total-display">
          <div class="token-total-big">🪙 ${this._fmt(balance)}</div>
          <div class="token-total-lbl">TOTAL TOKEN BALANCE</div>
          <div class="token-total-earned">+${this._fmt(earned)} earned today</div>
        </div>
        <div style="font-size:11px;color:var(--clr-p);opacity:0.4;text-align:center;margin-bottom:16px;font-family:'Share Tech Mono',monospace;font-style:italic;">
          "${this._esc(greetings[Math.floor(Math.random() * greetings.length)])}"
        </div>
        <div class="toggle-row">
          <span>${internetOn ? "[ INTERNET: ONLINE ]" : "[ INTERNET: OFFLINE ]"}</span>
          <button class="mini-btn toggle-inet-btn" style="background:${internetOn?"rgba(255,50,80,0.2)":"var(--clr-p)22"};color:${internetOn?"var(--clr-d)":"var(--clr-p)"};border:1px solid ${internetOn?"var(--clr-d)":"var(--clr-p)"};">
            ${internetOn ? "TURN OFF" : "TURN ON"}
          </button>
        </div>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button class="pill-btn btn-gold shop-goto-btn" style="flex:1;margin-top:0;">[ TOKEN SHOP ]</button>
          <button class="pill-btn btn-cyan keep-going-btn" style="flex:1;margin-top:0;">[ MORE QUESTIONS ]</button>
        </div>
        <div style="font-size:10px;color:var(--clr-p);opacity:0.3;text-align:center;margin-top:8px;font-family:'Share Tech Mono',monospace;">
          Extra questions earn half tokens
        </div>
      </div>`);

    const c = this.shadowRoot.querySelector("#content");
    c.querySelector(".toggle-inet-btn")?.addEventListener("click", () => {
      this._toggleInternet(!internetOn);
      setTimeout(() => this._renderResults(), 400);
    });
    c.querySelector(".shop-goto-btn")?.addEventListener("click", () => {
      this._activeTab = "shop"; this._renderNavTabs(); this._renderContent();
    });
    c.querySelector(".keep-going-btn")?.addEventListener("click", () => this._fetchExtraQuestion());
  }

  // ── SHOP ──────────────────────────────────────────────────────────────────

  _renderShop() {
    const balance   = this._getTokenBalance();
    const purchases = this._getPurchases();
    const items     = this._cfg.shop_items || DEFAULT_SHOP_ITEMS;

    let itemsHtml = "";
    TIER_ORDER.forEach(tier => {
      const tierItems = items.filter(i => i.tier === tier);
      if (!tierItems.length) return;
      itemsHtml += `<div class="tier-label tier-${tier}">${TIER_LABELS[tier]}</div>`;
      tierItems.forEach(item => {
        const canAfford    = balance >= item.cost;
        const shortage     = Math.round((item.cost - balance) * 10) / 10;
        const shortStr     = shortage % 1 === 0 ? shortage : shortage.toFixed(1);
        const timesRedeemed = purchases.filter(p => p.id === item.id).length;
        itemsHtml += `
          <div class="shop-item ${canAfford?"can-afford":"cant-afford"}">
            <div class="shop-item-icon">${item.icon}</div>
            <div class="shop-item-info">
              <div class="shop-item-name">${this._esc(item.label)}</div>
              <div class="shop-item-desc">${this._esc(item.desc)}${timesRedeemed>0 ? ` · Used ${timesRedeemed}×` : ""}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
              <div class="shop-item-cost">🪙 ${item.cost}</div>
              <button class="shop-buy-btn ${canAfford?"active":"locked"}" data-item-id="${item.id}">
                ${canAfford ? "[ REDEEM ]" : `NEED ${shortStr} MORE`}
              </button>
            </div>
          </div>`;
      });
    });

    let recentHtml = "";
    if (purchases.length > 0) {
      recentHtml = `<div class="tier-label" style="color:var(--clr-p);opacity:0.5;margin-top:16px;">[ RECENT PURCHASES ]</div>
        ${purchases.slice(0, 5).map(p => {
          const item = items.find(i => i.id === p.id);
          return `<div class="history-row" style="border-left:3px solid var(--clr-g);">
            <span style="font-size:18px">${item?.icon || "🎁"}</span>
            <div style="flex:1">
              <div style="font-size:12px;font-weight:700;color:#c8e8e0;">${this._esc(item?.label || p.id)}</div>
              <div style="font-size:10px;color:var(--clr-p);opacity:0.4;font-family:'Share Tech Mono',monospace;">${p.date}</div>
            </div>
            <div style="font-size:12px;color:var(--clr-g);font-family:'Share Tech Mono',monospace;font-weight:700;">-${p.cost} 🪙</div>
          </div>`;
        }).join("")}`;
    }

    this._setContent(`
      <div class="card">
        <div class="shop-header">
          <div class="shop-title">TOKEN SHOP</div>
          <div class="shop-balance">🪙 ${this._fmt(balance)}</div>
        </div>
        <div class="shop-sub">Earn tokens by answering questions correctly. Spend them on rewards below.</div>
        <div class="shop-rate-box">
          🟢 <strong>Easy = 🪙 ½</strong> &nbsp;·&nbsp;
          🟡 <strong>Normal = 🪙 1</strong> &nbsp;·&nbsp;
          🔴 <strong>Hard = 🪙 2</strong> &nbsp;·&nbsp;
          <span style="color:rgba(0,188,212,0.6);">⭐ Extra = half rate</span>
        </div>
        ${itemsHtml}
        ${recentHtml}
      </div>`);

    this.shadowRoot.querySelectorAll(".shop-buy-btn.active").forEach(btn => {
      btn.addEventListener("click", () => {
        const item = items.find(i => i.id === btn.dataset.itemId);
        if (item) this._showPurchaseConfirm(item);
      });
    });
  }

  _showPurchaseConfirm(item) {
    const balance = this._getTokenBalance();
    const modal   = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-box">
        <span class="modal-icon">${item.icon}</span>
        <div class="modal-title">${this._esc(item.label)}</div>
        <div class="modal-desc">${this._esc(item.desc)}<br><br>Your balance: <strong style="color:var(--clr-g)">${this._fmt(balance)} tokens</strong></div>
        <div class="modal-cost">🪙 ${item.cost} tokens</div>
        <div class="modal-btns">
          <button class="modal-confirm" id="mc-ok">[ CONFIRM ]</button>
          <button class="modal-cancel"  id="mc-no">[ CANCEL ]</button>
        </div>
      </div>`;
    this.shadowRoot.querySelector(".shell").appendChild(modal);
    modal.querySelector("#mc-ok").addEventListener("click", () => {
      modal.remove();
      if (this._spendTokens(item.cost)) {
        this._addPurchase(item);
        this._syncTopbar();
        this._showPurchaseSuccess(item);
      }
    });
    modal.querySelector("#mc-no").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  }

  _showPurchaseSuccess(item) {
    const overlay = document.createElement("div");
    overlay.className = "success-overlay";
    const balance = this._getTokenBalance();
    overlay.innerHTML = `
      <div class="success-box">
        <span class="success-icon">${item.icon}</span>
        <div class="success-title">REDEEMED!</div>
        <div class="success-desc">
          <strong style="color:#e8f4f0">${this._esc(item.label)}</strong><br>${this._esc(item.desc)}
          <br><br><span style="color:var(--clr-p);opacity:0.5;font-size:12px;font-family:'Share Tech Mono',monospace;">
            New balance: 🪙 ${this._fmt(balance)}
          </span>
        </div>
        <button class="success-close" id="sc-close">[ AWESOME! ]</button>
      </div>`;
    this.shadowRoot.querySelector(".shell").appendChild(overlay);
    overlay.querySelector("#sc-close").addEventListener("click", () => {
      overlay.remove();
      this._renderShop();
    });
  }

  // ── HISTORY ───────────────────────────────────────────────────────────────

  _renderHistory() {
    const history      = this._st.history || [];
    const balance      = this._getTokenBalance();
    const correct      = history.filter(h => h.correct).length;
    const extraCount   = history.filter(h => h.extra).length;

    const rows = history.length
      ? history.map(h => `
          <div class="history-row ${h.correct ? (h.extra ? "history-extra" : "history-correct") : "history-wrong"}">
            <span style="font-size:14px">${h.correct ? "✓" : "✗"}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#a0c8c0;">${this._esc(h.question || "Question")}</div>
              <span class="h-topic">${this._esc(h.topic)}</span>
              <span style="font-size:9px;color:var(--clr-p);opacity:0.4;margin-left:6px;font-family:'Share Tech Mono',monospace;">${h.diff===1?"EASY":h.diff===2?"NORMAL":"HARD"}</span>
              ${h.extra ? `<span style="font-size:9px;color:rgba(0,188,212,0.5);margin-left:5px;font-family:'Share Tech Mono',monospace;">EXTRA</span>` : ""}
            </div>
            <div class="h-tokens">${h.correct ? `+${this._fmt(h.tokens)} 🪙` : "—"}</div>
          </div>`).join("")
      : `<div style="text-align:center;padding:30px;color:var(--clr-p);opacity:0.3;font-family:'Share Tech Mono',monospace;font-size:12px;">NO DATA YET. ANSWER QUESTIONS TO BUILD HISTORY.</div>`;

    this._setContent(`
      <div class="card">
        <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
          <div style="flex:1;background:rgba(0,200,100,0.06);border:1px solid rgba(0,200,100,0.2);border-radius:8px;padding:12px;text-align:center;min-width:80px">
            <div style="font-family:'Creepster',cursive;font-size:24px;color:#00c864;">${correct}/${history.length}</div>
            <div style="font-size:9px;color:rgba(0,200,100,0.4);text-transform:uppercase;letter-spacing:1px;font-family:'Share Tech Mono',monospace;">CORRECT</div>
          </div>
          <div style="flex:1;background:var(--clr-g)10;border:1px solid var(--clr-g)33;border-radius:8px;padding:12px;text-align:center;min-width:80px">
            <div style="font-family:'Creepster',cursive;font-size:24px;color:var(--clr-g);">🪙 ${this._fmt(balance)}</div>
            <div style="font-size:9px;color:var(--clr-g);opacity:0.5;text-transform:uppercase;letter-spacing:1px;font-family:'Share Tech Mono',monospace;">BALANCE</div>
          </div>
          <div style="flex:1;background:rgba(0,188,212,0.06);border:1px solid rgba(0,188,212,0.2);border-radius:8px;padding:12px;text-align:center;min-width:80px">
            <div style="font-family:'Creepster',cursive;font-size:24px;color:#00bcd4;">${extraCount}</div>
            <div style="font-size:9px;color:rgba(0,188,212,0.4);text-transform:uppercase;letter-spacing:1px;font-family:'Share Tech Mono',monospace;">EXTRA Q'S</div>
          </div>
        </div>
        <div style="font-size:9px;color:var(--clr-p);opacity:0.4;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;font-family:'Share Tech Mono',monospace;">
          [ TODAY'S QUESTION LOG ]
        </div>
        ${rows}
      </div>`);
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────

  _esc(s) {
    if (!s) return "";
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  getCardSize() { return 12; }

  static getStubConfig() {
    return {
      type:                 "custom:kids-maths-dashboard",
      openai_key_entity:    "input_text.kids_maths_openai_key",
      internet_entity:      "input_boolean.kids_maths_internet",
      weak_topics_entity:   "input_text.kids_maths_weak_topics",
      cache_entity:         "input_text.kids_maths_question_cache",
      tokens_entity:        "input_text.kids_maths_token_balance",
      child_name:           "Alex",
      child_age:            9,
      school_year:          "Year 4",
      maths_level:          "Year 3",
      tutor_name:           "Aria",
      tutor_avatar:         "🤖",
    };
  }
}

// ── REGISTER ──────────────────────────────────────────────────────────────────

customElements.define("kids-maths-dashboard", KidsMathsDashboard);

window.customCards = window.customCards || [];
window.customCards.push({
  type:        "kids-maths-dashboard",
  name:        "Kids' Maths Dashboard",
  description: "Gamified daily maths practice with AI tutor + token reward shop — v1.0",
});

console.log(
  "%c Kids' Maths Dashboard v1.0 LOADED ",
  "background:#00c8a0;color:#001a14;font-size:13px;font-weight:bold;padding:4px 8px;border-radius:4px"
);
