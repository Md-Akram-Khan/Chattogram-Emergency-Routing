/* ==========================================================================
   CHATTOGRAM CITY EXTENDED GRAPH NETWORK DATASET (45 NODES & 85+ PATHS)
   Comprehensive high-density graph covering all major hospitals, emergency depots,
   ports, flyovers, bypasses, narrow galis, and coastal corridors across Chattogram.
   ========================================================================== */

const CHATTOGRAM_GRAPH = {
  nodes: {
    // ------------------- HOSPITALS & MEDICAL HUBS -------------------
    "cmch": {
      id: "cmch",
      name: "CMCH (Chattogram Med. College)",
      type: "hospital",
      lat: 22.3588,
      lng: 91.8210,
      description: "Apex Primary Emergency & Trauma Hospital in Chattogram"
    },
    "evercare_hosp": {
      id: "evercare_hosp",
      name: "Evercare Hospital Chattogram",
      type: "hospital",
      lat: 22.3780,
      lng: 91.8190,
      description: "Tertiary Speciality Hospital, Anannya Residential"
    },
    "imperial_hosp": {
      id: "imperial_hosp",
      name: "Imperial Hospital Ltd",
      type: "hospital",
      lat: 22.3635,
      lng: 91.7890,
      description: "Advanced Multi-Specialty Hospital, Pahartali"
    },
    "max_hosp": {
      id: "max_hosp",
      name: "Max Hospital & Diagnostic",
      type: "hospital",
      lat: 22.3525,
      lng: 91.8275,
      description: "Mehdibag Emergency Hospital Center"
    },
    "parkview_hosp": {
      id: "parkview_hosp",
      name: "Parkview Hospital",
      type: "hospital",
      lat: 22.3610,
      lng: 91.8235,
      description: "Panchlaish Catalganj Emergency Care"
    },
    "metro_hosp": {
      id: "metro_hosp",
      name: "Metropolitan Hospital",
      type: "hospital",
      lat: 22.3595,
      lng: 91.8250,
      description: "OR Nizam Road Medical Center"
    },
    "ctg_general_hosp": {
      id: "ctg_general_hosp",
      name: "Chattogram General Hospital",
      type: "hospital",
      lat: 22.3395,
      lng: 91.8365,
      description: "Historic General Govt Hospital, Andarkilla"
    },
    "bitid_faujdarhat": {
      id: "bitid_faujdarhat",
      name: "BITID Hospital Faujdarhat",
      type: "hospital",
      lat: 22.3990,
      lng: 91.7570,
      description: "Infectious Disease Research & Hospital"
    },
    "ustc_hospital": {
      id: "ustc_hospital",
      name: "USTC Medical College Hospital",
      type: "hospital",
      lat: 22.3650,
      lng: 91.7995,
      description: "Foy's Lake USTC Campus Hospital"
    },

    // ------------------- EMERGENCY STATIONS & DEPOTS -------------------
    "epz_circle": {
      id: "epz_circle",
      name: "CEPZ Emergency Fire Depot",
      type: "depot",
      lat: 22.2850,
      lng: 91.7910,
      description: "Chattogram EPZ Industrial Fire Station"
    },
    "patenga_depot": {
      id: "patenga_depot",
      name: "Patenga Coastal Emergency Depot",
      type: "depot",
      lat: 22.2500,
      lng: 91.7900,
      description: "Southernmost Sea Beach Emergency Post"
    },
    "chattogram_airport": {
      id: "chattogram_airport",
      name: "Shah Amanat Airport Depot",
      type: "depot",
      lat: 22.2500,
      lng: 91.8130,
      description: "International Airport Air-Rescue Hub"
    },
    "ctg_railway_station": {
      id: "ctg_railway_station",
      name: "Central Railway Station Depot",
      type: "depot",
      lat: 22.3340,
      lng: 91.8290,
      description: "BR Station Square Emergency Depot"
    },
    "bahaddarhat_depot": {
      id: "bahaddarhat_depot",
      name: "Bahaddarhat Bus Depot",
      type: "depot",
      lat: 22.3680,
      lng: 91.8440,
      description: "Eastern Highway Bus Terminal"
    },
    "kadamtali_depot": {
      id: "kadamtali_depot",
      name: "Kadamtali Inter-District Depot",
      type: "depot",
      lat: 22.3370,
      lng: 91.8220,
      description: "Inter-district Bus Station & Spare Parts Market"
    },
    "oxygen_depot": {
      id: "oxygen_depot",
      name: "Oxygen Highway Bus Station",
      type: "depot",
      lat: 22.3950,
      lng: 91.8200,
      description: "Northern Highway Bus & Emergency Post"
    },
    "dampara_police": {
      id: "dampara_police",
      name: "Dampara Police & Fire Stn",
      type: "depot",
      lat: 22.3520,
      lng: 91.8210,
      description: "Central Dampara Police Lines & Fire Depot"
    },
    "agra_fire_stn": {
      id: "agra_fire_stn",
      name: "Agrabad Fire Service HQ",
      type: "depot",
      lat: 22.3300,
      lng: 91.8120,
      description: "Divisional Headquarters Fire Station Agrabad"
    },

    // ------------------- INTERSECTIONS & FLYOVERS -------------------
    "gec_circle": {
      id: "gec_circle",
      name: "GEC Circle (Nasirabad)",
      type: "hub",
      lat: 22.3580,
      lng: 91.8215,
      description: "CDA Avenue Commercial Crossroads"
    },
    "2no_gate": {
      id: "2no_gate",
      name: "Sholashahar 2 No. Gate",
      type: "intersection",
      lat: 22.3660,
      lng: 91.8240,
      description: "Akhtar Uz Zaman Flyover Hub, High Tidal Flood Risk"
    },
    "muradpur": {
      id: "muradpur",
      name: "Muradpur Intersection",
      type: "intersection",
      lat: 22.3650,
      lng: 91.8330,
      description: "Flyover East Ramp & Waterlogging Hotspot"
    },
    "bahaddarhat": {
      id: "bahaddarhat",
      name: "Bahaddarhat Flyover Circle",
      type: "intersection",
      lat: 22.3685,
      lng: 91.8420,
      description: "Kalurghat Highway Intersection"
    },
    "chawkbazar": {
      id: "chawkbazar",
      name: "Chawkbazar Intersection",
      type: "intersection",
      lat: 22.3510,
      lng: 91.8340,
      description: "Educational Market Hub (Premier Univ)"
    },
    "andarkilla": {
      id: "andarkilla",
      name: "Andarkilla (Old City)",
      type: "intersection",
      lat: 22.3380,
      lng: 91.8350,
      description: "Historic Old Town Wholesale District"
    },
    "khatunganj": {
      id: "khatunganj",
      name: "Khatunganj Trade Corridor",
      type: "intersection",
      lat: 22.3350,
      lng: 91.8410,
      description: "Largest Commodity Wholesale Market in BD"
    },
    "terribazar": {
      id: "terribazar",
      name: "Terribazar Shopping Lane",
      type: "intersection",
      lat: 22.3390,
      lng: 91.8380,
      description: "Dense Clothing Market Narrow Alley"
    },
    "kotwali": {
      id: "kotwali",
      name: "Kotwali Circle",
      type: "hub",
      lat: 22.3350,
      lng: 91.8370,
      description: "Central Court & Police Station Junction"
    },
    "lalkhan_bazar": {
      id: "lalkhan_bazar",
      name: "Lalkhan Bazar Junction",
      type: "intersection",
      lat: 22.3505,
      lng: 91.8180,
      description: "Flyover Entrance & Hilly Road Link"
    },
    "tigerpass": {
      id: "tigerpass",
      name: "Tigerpass Hilly Pass",
      type: "intersection",
      lat: 22.3420,
      lng: 91.8135,
      description: "Scenic Hill Pass Road"
    },
    "crb_hilly_road": {
      id: "crb_hilly_road",
      name: "CRB Heritage Hilly Pass",
      type: "intersection",
      lat: 22.3450,
      lng: 91.8210,
      description: "Central Railway Building Hilly Shortcut"
    },
    "dewanhat": {
      id: "dewanhat",
      name: "Dewanhat Overbridge",
      type: "intersection",
      lat: 22.3385,
      lng: 91.8140,
      description: "Agrabad & Port Access Overbridge"
    },
    "agrabad_ca": {
      id: "agrabad_ca",
      name: "Agrabad C/A Commercial Hub",
      type: "hub",
      lat: 22.3285,
      lng: 91.8105,
      description: "Financial District (Severe Tidal Flood Prone)"
    },
    "chattogram_port_g1": {
      id: "chattogram_port_g1",
      name: "Chattogram Port Gate 1",
      type: "depot",
      lat: 22.3160,
      lng: 91.8020,
      description: "Primary Port Maritime Gate"
    },
    "chattogram_port_g4": {
      id: "chattogram_port_g4",
      name: "Chattogram Port Gate 4",
      type: "depot",
      lat: 22.3210,
      lng: 91.8050,
      description: "Custom House Container Gate"
    },
    "saltgola": {
      id: "saltgola",
      name: "Saltgola Crossing",
      type: "intersection",
      lat: 22.3020,
      lng: 91.7960,
      description: "Heavy Freight Trailer Bottleneck"
    },
    "halishahar_block_a": {
      id: "halishahar_block_a",
      name: "Halishahar Housing A-Block",
      type: "intersection",
      lat: 22.3320,
      lng: 91.7890,
      description: "Residential Sector Intersection"
    },
    "halishahar_block_l": {
      id: "halishahar_block_l",
      name: "Halishahar Coastal L-Block",
      type: "intersection",
      lat: 22.3210,
      lng: 91.7780,
      description: "Low-lying Tidal Submersion Zone"
    },
    "pahartali_junction": {
      id: "pahartali_junction",
      name: "Pahartali Railway Junction",
      type: "intersection",
      lat: 22.3630,
      lng: 91.7920,
      description: "Western Rail Workshop Crossroads"
    },
    "foys_lake": {
      id: "foys_lake",
      name: "Foy's Lake Complex Gate",
      type: "intersection",
      lat: 22.3620,
      lng: 91.8020,
      description: "Amusement Park & Lake Hilly Gate"
    },
    "bayezid_link": {
      id: "bayezid_link",
      name: "Bayezid Link Road Toll Plaza",
      type: "intersection",
      lat: 22.3850,
      lng: 91.8050,
      description: "Hilly Expressway Link to Faujdarhat"
    },
    "bayezid_shrine": {
      id: "bayezid_shrine",
      name: "Bayezid Bostami Shrine",
      type: "intersection",
      lat: 22.3820,
      lng: 91.8270,
      description: "Historic Shrine Intersection"
    },
    "oxygen_circle": {
      id: "oxygen_circle",
      name: "Oxygen Chowrasta Gateway",
      type: "hub",
      lat: 22.3950,
      lng: 91.8200,
      description: "Rangamati & Highway Northern Entry"
    },
    "kalurghat_bridge": {
      id: "kalurghat_bridge",
      name: "Kalurghat Heavy Rail-Road Bridge",
      type: "intersection",
      lat: 22.3880,
      lng: 91.8680,
      description: "Karnaphuli River Bridge Crossing"
    },
    "karnaphuli_tunnel_north": {
      id: "karnaphuli_tunnel_north",
      name: "Bangabandhu Tunnel North Ramp",
      type: "intersection",
      lat: 22.2420,
      lng: 91.8010,
      description: "Under-river Tunnel Entrance at Patenga"
    },
    "port_connecting_rd": {
      id: "port_connecting_rd",
      name: "Port Connecting Toll Expressway",
      type: "intersection",
      lat: 22.3450,
      lng: 91.7890,
      description: "Freight Truck Bypass Route"
    },
    "faujdarhat_bypass": {
      id: "faujdarhat_bypass",
      name: "Faujdarhat Highway Bypass",
      type: "depot",
      lat: 22.3980,
      lng: 91.7580,
      description: "Dhaka-Chattogram Highway Entrance"
    },
    "bhatiari": {
      id: "bhatiari",
      name: "Bhatiari Golf & Military Hub",
      type: "intersection",
      lat: 22.4200,
      lng: 91.7450,
      description: "Northern Highway Suburb"
    }
  },

  edges: [
    // ------------------- CMCH & MEDICAL CENTRAL PATHS -------------------
    { id: "e1", u: "cmch", v: "gec_circle", distance_km: 0.8, road_type: "arterial", flood_susceptibility: 0.15, night_safety: 0.95, junction_delay_sec: 25, name: "KB Fazlul Kader Road (CMCH Front)" },
    { id: "e2", u: "cmch", v: "parkview_hosp", distance_km: 0.4, road_type: "avenue", flood_susceptibility: 0.2, night_safety: 0.9, junction_delay_sec: 15, name: "Catalganj Medical Alley" },
    { id: "e3", u: "cmch", v: "metro_hosp", distance_km: 0.5, road_type: "avenue", flood_susceptibility: 0.2, night_safety: 0.9, junction_delay_sec: 20, name: "OR Nizam Road Link" },
    { id: "e4", u: "cmch", v: "chawkbazar", distance_km: 1.4, road_type: "avenue", flood_susceptibility: 0.45, night_safety: 0.8, junction_delay_sec: 45, name: "Medical College Eastern Link Road" },
    { id: "e5", u: "cmch", v: "max_hosp", distance_km: 1.1, road_type: "avenue", flood_susceptibility: 0.3, night_safety: 0.85, junction_delay_sec: 30, name: "Mehdibag Road" },

    // ------------------- GEC, 2 NO. GATE, MURADPUR, EVERCARE -------------------
    { id: "e6", u: "gec_circle", v: "2no_gate", distance_km: 1.2, road_type: "arterial", flood_susceptibility: 0.65, night_safety: 0.9, junction_delay_sec: 50, name: "CDA Avenue (GEC to 2 No. Gate)" },
    { id: "e7", u: "gec_circle", v: "lalkhan_bazar", distance_km: 1.1, road_type: "arterial", flood_susceptibility: 0.1, night_safety: 0.9, junction_delay_sec: 40, name: "CDA Avenue (GEC to Lalkhan Bazar)" },
    { id: "e8", u: "gec_circle", v: "dampara_police", distance_km: 0.7, road_type: "avenue", flood_susceptibility: 0.1, night_safety: 0.9, junction_delay_sec: 25, name: "Dampara Avenue" },
    { id: "e9", u: "2no_gate", v: "muradpur", distance_km: 1.0, road_type: "arterial", flood_susceptibility: 0.9, night_safety: 0.85, junction_delay_sec: 60, name: "Sholashahar Tidal Flood Corridor" },
    { id: "e10", u: "2no_gate", v: "bayezid_shrine", distance_km: 1.9, road_type: "avenue", flood_susceptibility: 0.3, night_safety: 0.75, junction_delay_sec: 40, name: "Sholashahar Industrial Link" },
    { id: "e11", u: "muradpur", v: "bahaddarhat", distance_km: 1.3, road_type: "arterial", flood_susceptibility: 0.85, night_safety: 0.8, junction_delay_sec: 55, name: "Akhtar Uz Zaman Flyover Ramp" },
    { id: "e12", u: "bahaddarhat", v: "bahaddarhat_depot", distance_km: 0.5, road_type: "avenue", flood_susceptibility: 0.8, night_safety: 0.75, junction_delay_sec: 35, name: "Bahaddarhat Terminal Approach" },
    { id: "e13", u: "bahaddarhat", v: "kalurghat_bridge", distance_km: 3.8, road_type: "arterial", flood_susceptibility: 0.7, night_safety: 0.7, junction_delay_sec: 50, name: "Kalurghat Heavy Industrial Road" },

    // ------------------- BAYEZID & EVERCARE & OXYGEN -------------------
    { id: "e14", u: "gec_circle", v: "bayezid_shrine", distance_km: 2.8, road_type: "avenue", flood_susceptibility: 0.2, night_safety: 0.8, junction_delay_sec: 35, name: "Bayezid Bostami Main Road" },
    { id: "e15", u: "bayezid_shrine", v: "evercare_hosp", distance_km: 0.9, road_type: "avenue", flood_susceptibility: 0.1, night_safety: 0.85, junction_delay_sec: 25, name: "Anannya Avenue to Evercare" },
    { id: "e16", u: "bayezid_shrine", v: "oxygen_circle", distance_km: 1.6, road_type: "arterial", flood_susceptibility: 0.2, night_safety: 0.8, junction_delay_sec: 45, name: "Oxygen-Bayezid Connector" },
    { id: "e17", u: "oxygen_circle", v: "oxygen_depot", distance_km: 0.3, road_type: "avenue", flood_susceptibility: 0.2, night_safety: 0.8, junction_delay_sec: 20, name: "Oxygen Bus Depot Road" },
    { id: "e18", u: "oxygen_circle", v: "bayezid_link", distance_km: 2.1, road_type: "arterial", flood_susceptibility: 0.15, night_safety: 0.8, junction_delay_sec: 30, name: "Bayezid Link Expressway East" },

    // ------------------- CHAWKBAZAR, KHATUNGANJ, ANDARKILLA, KOTWALI -------------------
    { id: "e19", u: "muradpur", v: "chawkbazar", distance_km: 1.8, road_type: "street", flood_susceptibility: 0.75, night_safety: 0.7, junction_delay_sec: 50, name: "College Road to Chawkbazar" },
    { id: "e20", u: "chawkbazar", v: "max_hosp", distance_km: 0.7, road_type: "street", flood_susceptibility: 0.4, night_safety: 0.8, junction_delay_sec: 30, name: "Mehdibag Chawkbazar Link" },
    { id: "e21", u: "chawkbazar", v: "andarkilla", distance_km: 1.5, road_type: "alley", flood_susceptibility: 0.6, night_safety: 0.6, junction_delay_sec: 55, name: "Siraj-ud-Daula Road (Old City Market)" },
    { id: "e22", u: "andarkilla", v: "terribazar", distance_km: 0.4, road_type: "alley", flood_susceptibility: 0.65, night_safety: 0.55, junction_delay_sec: 40, name: "Terribazar Market Gali" },
    { id: "e23", u: "andarkilla", v: "khatunganj", distance_km: 0.9, road_type: "alley", flood_susceptibility: 0.85, night_safety: 0.5, junction_delay_sec: 60, name: "Khatunganj Commodity Trade Lane" },
    { id: "e24", u: "andarkilla", v: "ctg_general_hosp", distance_km: 0.3, road_type: "street", flood_susceptibility: 0.4, night_safety: 0.8, junction_delay_sec: 20, name: "General Hospital Gate Road" },
    { id: "e25", u: "andarkilla", v: "kotwali", distance_km: 0.8, road_type: "street", flood_susceptibility: 0.5, night_safety: 0.7, junction_delay_sec: 40, name: "Andarkilla Shahi Masjid Road" },
    { id: "e26", u: "khatunganj", v: "kotwali", distance_km: 0.7, road_type: "street", flood_susceptibility: 0.9, night_safety: 0.55, junction_delay_sec: 45, name: "Boxirhat Road" },

    // ------------------- RAILWAY STATION, KADAMTALI, HILLY CORRIDORS -------------------
    { id: "e27", u: "kotwali", v: "ctg_railway_station", distance_km: 0.9, road_type: "avenue", flood_susceptibility: 0.4, night_safety: 0.75, junction_delay_sec: 35, name: "Station Road (Kotwali Link)" },
    { id: "e28", u: "ctg_railway_station", v: "kadamtali_depot", distance_km: 0.7, road_type: "street", flood_susceptibility: 0.5, night_safety: 0.7, junction_delay_sec: 30, name: "Kadamtali Spare Parts Lane" },
    { id: "e29", u: "ctg_railway_station", v: "crb_hilly_road", distance_km: 1.0, road_type: "street", flood_susceptibility: 0.1, night_safety: 0.75, junction_delay_sec: 25, name: "CRB Hill Pass Road" },
    { id: "e30", u: "crb_hilly_road", v: "tigerpass", distance_km: 0.9, road_type: "street", flood_susceptibility: 0.1, night_safety: 0.8, junction_delay_sec: 25, name: "Batali Hill Shortcut" },
    { id: "e31", u: "lalkhan_bazar", v: "dampara_police", distance_km: 0.4, road_type: "avenue", flood_susceptibility: 0.1, night_safety: 0.9, junction_delay_sec: 20, name: "Dampara Police Station Road" },
    { id: "e32", u: "lalkhan_bazar", v: "tigerpass", distance_km: 1.1, road_type: "arterial", flood_susceptibility: 0.05, night_safety: 0.9, junction_delay_sec: 30, name: "Tigerpass Scenic Hilly Pass" },

    // ------------------- TIGERPASS, DEWANHAT, AGRABAD & PORT -------------------
    { id: "e33", u: "tigerpass", v: "dewanhat", distance_km: 1.0, road_type: "arterial", flood_susceptibility: 0.2, night_safety: 0.85, junction_delay_sec: 45, name: "Dewanhat Overbridge Approach" },
    { id: "e34", u: "kadamtali_depot", v: "dewanhat", distance_km: 0.6, road_type: "avenue", flood_susceptibility: 0.4, night_safety: 0.75, junction_delay_sec: 30, name: "Dewanhat Bus Ramp" },
    { id: "e35", u: "dewanhat", v: "agra_fire_stn", distance_km: 1.0, road_type: "arterial", flood_susceptibility: 0.75, night_safety: 0.85, junction_delay_sec: 40, name: "Fire Service Access Road" },
    { id: "e36", u: "agra_fire_stn", v: "agrabad_ca", distance_km: 0.3, road_type: "arterial", flood_susceptibility: 0.85, night_safety: 0.9, junction_delay_sec: 20, name: "Agrabad Commercial Boulevard" },
    { id: "e37", u: "dewanhat", v: "agrabad_ca", distance_km: 1.2, road_type: "arterial", flood_susceptibility: 0.8, night_safety: 0.85, junction_delay_sec: 60, name: "Agrabad Commercial Corridor" },
    { id: "e38", u: "agrabad_ca", v: "chattogram_port_g4", distance_km: 1.2, road_type: "arterial", flood_susceptibility: 0.85, night_safety: 0.8, junction_delay_sec: 50, name: "Custom House Road" },
    { id: "e39", u: "chattogram_port_g4", v: "chattogram_port_g1", distance_km: 0.8, road_type: "arterial", flood_susceptibility: 0.9, night_safety: 0.75, junction_delay_sec: 40, name: "Port Strand Road" },

    // ------------------- HALISHAHAR, PORT CONNECTING, PAHARTALI -------------------
    { id: "e40", u: "agrabad_ca", v: "halishahar_block_a", distance_km: 2.1, road_type: "street", flood_susceptibility: 0.9, night_safety: 0.7, junction_delay_sec: 45, name: "Halishahar Access Road" },
    { id: "e41", u: "halishahar_block_a", v: "halishahar_block_l", distance_km: 1.5, road_type: "broken", flood_susceptibility: 0.95, night_safety: 0.6, junction_delay_sec: 35, name: "Halishahar Coastal Embankment" },
    { id: "e42", u: "halishahar_block_a", v: "port_connecting_rd", distance_km: 1.8, road_type: "avenue", flood_susceptibility: 0.7, night_safety: 0.7, junction_delay_sec: 40, name: "Halishahar Trunk Link" },
    { id: "e43", u: "dewanhat", v: "port_connecting_rd", distance_km: 2.1, road_type: "arterial", flood_susceptibility: 0.4, night_safety: 0.75, junction_delay_sec: 50, name: "Port Connecting Toll Expressway" },
    { id: "e44", u: "port_connecting_rd", v: "pahartali_junction", distance_km: 2.2, road_type: "avenue", flood_susceptibility: 0.3, night_safety: 0.7, junction_delay_sec: 40, name: "Pahartali Rail Link Road" },
    { id: "e45", u: "pahartali_junction", v: "imperial_hosp", distance_km: 0.5, road_type: "avenue", flood_susceptibility: 0.2, night_safety: 0.85, junction_delay_sec: 20, name: "Imperial Hospital Front Road" },
    { id: "e46", u: "pahartali_junction", v: "foys_lake", distance_km: 1.2, road_type: "avenue", flood_susceptibility: 0.2, night_safety: 0.75, junction_delay_sec: 30, name: "Foy's Lake Link Road" },
    { id: "e47", u: "foys_lake", v: "ustc_hospital", distance_km: 0.6, road_type: "street", flood_susceptibility: 0.2, night_safety: 0.8, junction_delay_sec: 20, name: "USTC Campus Gate Road" },

    // ------------------- PORT FREIGHT, SALTGOLA, CEPZ, PATENGA -------------------
    { id: "e48", u: "chattogram_port_g1", v: "saltgola", distance_km: 2.2, road_type: "arterial", flood_susceptibility: 0.85, night_safety: 0.7, junction_delay_sec: 60, name: "Saltgola Lorry Freight Corridor" },
    { id: "e49", u: "saltgola", v: "epz_circle", distance_km: 2.1, road_type: "arterial", flood_susceptibility: 0.8, night_safety: 0.75, junction_delay_sec: 55, name: "EPZ Freight Highway" },
    { id: "e50", u: "epz_circle", v: "patenga_depot", distance_km: 4.2, road_type: "arterial", flood_susceptibility: 0.7, night_safety: 0.8, junction_delay_sec: 40, name: "Patenga Coastal Airport Highway" },
    { id: "e51", u: "patenga_depot", v: "chattogram_airport", distance_km: 2.1, road_type: "arterial", flood_susceptibility: 0.5, night_safety: 0.85, junction_delay_sec: 30, name: "Shah Amanat Airport Road" },
    { id: "e52", u: "patenga_depot", v: "karnaphuli_tunnel_north", distance_km: 1.2, road_type: "arterial", flood_susceptibility: 0.4, night_safety: 0.9, junction_delay_sec: 25, name: "Bangabandhu Tunnel Patenga Ramp" },
    { id: "e53", u: "halishahar_block_l", v: "saltgola", distance_km: 2.5, road_type: "broken", flood_susceptibility: 0.9, night_safety: 0.5, junction_delay_sec: 45, name: "Halishahar-Saltgola Coastal Road" },

    // ------------------- NORTHERN HIGHWAYS & BAYEZID BYPASS -------------------
    { id: "e54", u: "foys_lake", v: "bayezid_link", distance_km: 2.8, road_type: "arterial", flood_susceptibility: 0.15, night_safety: 0.8, junction_delay_sec: 35, name: "Bayezid Hilly Link Expressway West" },
    { id: "e55", u: "bayezid_link", v: "faujdarhat_bypass", distance_km: 3.5, road_type: "arterial", flood_susceptibility: 0.1, night_safety: 0.85, junction_delay_sec: 30, name: "Faujdarhat-Bayezid Expressway" },
    { id: "e56", u: "pahartali_junction", v: "faujdarhat_bypass", distance_km: 4.5, road_type: "arterial", flood_susceptibility: 0.2, night_safety: 0.8, junction_delay_sec: 45, name: "Dhaka-Chattogram Highway Trunk" },
    { id: "e57", u: "faujdarhat_bypass", v: "bitid_faujdarhat", distance_km: 0.6, road_type: "avenue", flood_susceptibility: 0.2, night_safety: 0.85, junction_delay_sec: 15, name: "BITID Hospital Front Road" },
    { id: "e58", u: "faujdarhat_bypass", v: "bhatiari", distance_km: 2.8, road_type: "arterial", flood_susceptibility: 0.1, night_safety: 0.85, junction_delay_sec: 30, name: "Dhaka-Ctg Highway Bhatiari Segment" },
    { id: "e59", u: "oxygen_circle", v: "faujdarhat_bypass", distance_km: 6.2, road_type: "arterial", flood_susceptibility: 0.15, night_safety: 0.8, junction_delay_sec: 40, name: "Bayezid Bostami Northern Bypass" }
  ]
};

if (typeof window !== 'undefined') {
  window.CHATTOGRAM_GRAPH = CHATTOGRAM_GRAPH;
  window.DHAKA_GRAPH = CHATTOGRAM_GRAPH; // Fallback
}
