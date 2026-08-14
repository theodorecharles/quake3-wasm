'use strict';

function desiredBots(humans, slots) {
  return Math.max(0, Number(slots) - Math.max(0, Number(humans) || 0));
}

function fillPlan(state) {
  const humans = Math.max(0, Number(state.humans) || 0);
  const bots = Math.max(0, Number(state.bots) || 0);
  const target = desiredBots(humans, state.slots);
  return {
    humans, bots, target, slots: state.slots,
    add: Math.min(2, Math.max(0, target - bots)),
    remove: Math.min(2, Math.max(0, bots - target))
  };
}

module.exports = { desiredBots, fillPlan };
