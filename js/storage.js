const PersistentStore = {
  PREFIX: "ctg-routing.v1.",

  read(key, fallback) {
    try {
      const raw = window.localStorage.getItem(this.PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  },

  write(key, value) {
    try {
      window.localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  },

  revision() {
    return this.read("revision", 0);
  },

  bumpRevision() {
    const next = this.revision() + 1;
    this.write("revision", next);
    return next;
  },

  loadOverrides() {
    return this.read("overrides", {});
  },

  saveOverrides(overrides) {
    this.write("overrides", overrides);
    return this.bumpRevision();
  },

  loadScenarios() {
    const list = this.read("scenarios", []);
    const valid = [];
    list.forEach(s => {
      try { valid.push(ScenarioSystem.validate(s)); } catch (err) { }
    });
    return valid;
  },

  saveScenarios(scenarios) {
    this.write("scenarios", scenarios);
    return this.bumpRevision();
  }
};

if (typeof window !== 'undefined') {
  window.PersistentStore = PersistentStore;
}
