// Lane jumping: "actually change my address" while the call is at the contact step.
import { GROUPS, SLOTS, STATES, STATES_ORDER, META } from "../script/index.js";
import { wants } from "./flow.js";

const slotsOfGroup = (g) => Object.entries(SLOTS).filter(([, d]) => d.group === g).map(([k]) => k);

// Is the current state already collecting something from this group? Then no jump is needed.
const collectingGroup = (s, gid) => {
  const cfg = STATES[s.state];
  return s.state === GROUPS[gid].entry || [...wants(cfg)].some((k) => SLOTS[k]?.group === gid);
};

/** Returns { transfer: reason|null, specs: [...] } for a classifier's update_targets. */
export function planJumps(s, targets) {
  const byGroup = new Map();
  for (const t of targets) {
    const gid = GROUPS[t] ? t : SLOTS[t]?.group;
    const g = GROUPS[gid];
    if (!g || g.inline) continue;                                // e.g. language: applied directly
    const whole = !!GROUPS[t];
    const entry = byGroup.get(gid) || { group: gid, whole: false, slots: new Set() };
    if (whole) entry.whole = true; else entry.slots.add(t);
    byGroup.set(gid, entry);
  }
  if (!byGroup.size) return { transfer: null, specs: [] };
  if (s.flags.complaint_registered && META.post_registration_updates === "transfer") return { transfer: "profile_update", specs: [] };   // policy switch in states.json

  const specs = [];
  for (const [gid, t] of byGroup) {
    const g = GROUPS[gid];
    if (g.requires_flag && !s.flags[g.requires_flag]) return { transfer: "profile_update", specs: [] };
    if (collectingGroup(s, gid)) continue;                       // normal overwrite rules apply
    if (!s.loops[g.entry]) continue;                             // never reached: treat as volunteered info
    const targeted = t.whole || !t.slots.size ? slotsOfGroup(gid) : [...t.slots];
    specs.push({ group: gid, entry: g.entry, return_before: g.return_before || [], slots: targeted, clear: [...new Set([...targeted, ...(g.clear || [])])] });
  }
  specs.sort((a, b) => STATES_ORDER.indexOf(a.entry) - STATES_ORDER.indexOf(b.entry));
  return { transfer: null, specs };
}