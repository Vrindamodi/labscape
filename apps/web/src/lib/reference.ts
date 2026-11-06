/** Small offline reference data for search (the full periodic table and formula library are Parts 2 and 3). */

const NAMES =
  "Hydrogen Helium Lithium Beryllium Boron Carbon Nitrogen Oxygen Fluorine Neon Sodium Magnesium Aluminium Silicon Phosphorus Sulfur Chlorine Argon Potassium Calcium Scandium Titanium Vanadium Chromium Manganese Iron Cobalt Nickel Copper Zinc Gallium Germanium Arsenic Selenium Bromine Krypton Rubidium Strontium Yttrium Zirconium Niobium Molybdenum Technetium Ruthenium Rhodium Palladium Silver Cadmium Indium Tin Antimony Tellurium Iodine Xenon Caesium Barium Lanthanum Cerium Praseodymium Neodymium Promethium Samarium Europium Gadolinium Terbium Dysprosium Holmium Erbium Thulium Ytterbium Lutetium Hafnium Tantalum Tungsten Rhenium Osmium Iridium Platinum Gold Mercury Thallium Lead Bismuth Polonium Astatine Radon Francium Radium Actinium Thorium Protactinium Uranium Neptunium Plutonium Americium Curium Berkelium Californium Einsteinium Fermium Mendelevium Nobelium Lawrencium Rutherfordium Dubnium Seaborgium Bohrium Hassium Meitnerium Darmstadtium Roentgenium Copernicium Nihonium Flerovium Moscovium Livermorium Tennessine Oganesson".split(
    " ",
  );
const SYMBOLS =
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(
    " ",
  );

export const ELEMENTS = SYMBOLS.map((symbol, i) => ({ z: i + 1, symbol, name: NAMES[i] ?? symbol }));

export const FORMULAS = [
  { name: "Newton's second law", expr: "F = ma", tags: "force mechanics" },
  { name: "Ohm's law", expr: "V = IR", tags: "circuit voltage current resistance" },
  { name: "Simple pendulum", expr: "T = 2π√(L/g)", tags: "oscillation period gravity" },
  { name: "Kinetic energy", expr: "Eₖ = ½mv²", tags: "energy motion" },
  { name: "Snell's law", expr: "n₁ sin θ₁ = n₂ sin θ₂", tags: "refraction light optics" },
  { name: "Specific heat capacity", expr: "E = mcΔθ", tags: "heat thermal energy" },
  { name: "Ideal gas law", expr: "pV = nRT", tags: "gas pressure chemistry" },
  { name: "Moles", expr: "n = m / M", tags: "amount chemistry mass" },
  { name: "Concentration", expr: "c = n / V", tags: "molarity solution titration" },
  { name: "pH", expr: "pH = −log₁₀[H⁺]", tags: "acid base" },
  { name: "Quadratic formula", expr: "x = (−b ± √(b² − 4ac)) / 2a", tags: "algebra roots" },
  { name: "Pythagoras", expr: "a² + b² = c²", tags: "triangle geometry trigonometry" },
  { name: "Derivative of xⁿ", expr: "d/dx xⁿ = n·xⁿ⁻¹", tags: "calculus differentiation" },
  { name: "Wave speed", expr: "v = fλ", tags: "waves frequency wavelength" },
];
