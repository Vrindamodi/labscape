/**
 * Beginner guidance for each experiment (ages 12-16), kept apart from the reviewed content JSON:
 * - idea: the big idea, shown before the demo starts;
 * - beats: why each demo caption matters (same order as golden.captions);
 * - whatIf: the real consequence of each mistake the model can spot (by deviation code);
 * - explore: "what if I...?" questions for each step of Try.
 * Every field is optional in use: an experiment without a guide still works.
 */
export type SimGuide = {
  idea: { title: string; body: string; watch: string[] };
  beats: string[];
  whatIf: Record<string, string>;
  explore: Record<string, { q: string; a: string }[]>;
};

const CIRCUIT_WHATIF: Record<string, string> = {
  "ammeter-parallel": "Wired across a part, the ammeter becomes an easy path with almost no resistance. Nearly all the current rushes through it instead of the part, so the reading is wrong and the meter or battery could be damaged.",
  "voltmeter-series": "In the loop, the voltmeter's huge resistance blocks almost all the current. The bulb or resistor gets nothing and the ammeter reads about zero, so every reading you take is useless.",
  "short-circuit": "With nothing to limit it, the current becomes huge. Real wires get hot enough to burn skin and the battery is ruined in minutes.",
  "read-while-off": "With the switch open no current flows, so the meter shows 0. That point would sit at the origin of your graph and tell you nothing new.",
  misread: "A wrong reading puts a point off the line on your graph, so the gradient (your answer) comes out wrong.",
};

export const PHYSICS_GUIDES: Record<string, SimGuide> = {
  "ohms-law": {
    idea: {
      title: "Does doubling the push double the current?",
      body: "A battery pushes charge round a circuit (that push is voltage, V). The resistor resists the flow (resistance, R, in ohms). The flow itself is current (I, in amps). Ohm's law says V = I × R: for a resistor at a steady temperature, double the voltage and the current doubles too.",
      watch: ["The ammeter goes in the loop; the voltmeter goes across the resistor.", "Each new rheostat setting gives a new pair of readings.", "V ÷ I comes out the same every time: that number is R."],
    },
    beats: [
      "Building with the switch open is the safe habit: no current can flow while you are still connecting wires, so a mistake cannot cause a short.",
      "A voltmeter measures the difference in push between two points, so it must touch both ends of the resistor. In the loop, its huge resistance would block the current.",
      "Opening the switch between readings stops the resistor warming up. A warm resistor has a higher resistance, which would bend your graph.",
      "The rheostat is a variable resistor. Changing it changes the total resistance, so the current and the voltage across the resistor both change.",
      "If V ÷ I is the same for every reading, the V-I graph is a straight line through the origin. Its gradient is the resistance.",
    ],
    whatIf: {
      ...CIRCUIT_WHATIF,
      "closed-too-early": "Closing the switch before checking the wiring is how real shorts and burnt meters happen. Always build, check, then switch on.",
      "left-on": "Leaving the current on heats the resistor. Hotter metal resists more, so later readings give a bigger R and your points curve away from the straight line.",
      "resistor-hot": "The resistor warmed up, so its resistance went up. Your later readings are for a different resistance, which spoils the straight-line graph.",
      "wrong-R": "R is the gradient of the V-I graph (V ÷ I). Using one reading, or I ÷ V, gives the wrong value.",
    },
    explore: {
      build: [
        { q: "What if I put the ammeter across the resistor?", a: "It would be a near short: the ammeter has almost no resistance, so most current goes through it, not the resistor." },
        { q: "What if I put the voltmeter in the loop?", a: "Its huge resistance blocks the current, so almost nothing flows and both meters read near zero." },
      ],
      close: [{ q: "What if a meter reads backwards?", a: "Its + and − are swapped. Real meters need + towards the battery's + side." }],
      readings: [
        { q: "What if I leave the switch on between readings?", a: "The resistor heats up, its resistance rises, and your later points drift off the straight line." },
        { q: "What if I take only two readings?", a: "Two points always make a straight line, so you could not tell if Ohm's law really holds. Five spread-out readings show the pattern." },
      ],
      result: [{ q: "What if I use one reading instead of the graph?", a: "One reading carries all its own error. The gradient of the best-fit line averages the errors out." }],
    },
  },
  "series-and-parallel": {
    idea: {
      title: "One path or many?",
      body: "In series, parts are in one single loop: the same current goes through each, and the battery's push is shared. In parallel, each part has its own branch: each gets the full push, and the branch currents add up.",
      watch: ["Two bulbs in series are dim.", "In parallel they are bright and the battery gives more current.", "Unscrew one parallel bulb and the other stays lit."],
    },
    beats: [
      "One loop means the current has no choice: it must pass through both bulbs, one after the other.",
      "Two bulbs in series make double the resistance, so the current halves. Each bulb also gets only half the voltage, so both glow dimly.",
      "Joining both ends of each bulb to the same two points gives each one its own path, called a branch.",
      "Each branch gets the full battery voltage, so each bulb is as bright as if it were alone. The battery supplies the current for both branches, so the ammeter reading goes up.",
      "Branches are independent: breaking one does not break the other path. That is why house lights are wired in parallel.",
    ],
    whatIf: { ...CIRCUIT_WHATIF },
    explore: {
      series: [{ q: "What if I add a third bulb in series?", a: "More resistance, less current: all three get dimmer. One break anywhere and all go out." }],
      "series-read": [{ q: "What if I move the ammeter elsewhere in the series loop?", a: "It reads the same anywhere: in series the current is the same at every point." }],
      parallel: [{ q: "What if I add a third bulb in parallel?", a: "It is just as bright as the others, and the battery current goes up again. The battery runs down faster." }],
      unscrew: [{ q: "What if this were a series circuit?", a: "Unscrewing one bulb breaks the only loop, so the other bulb goes out too." }],
    },
  },
  "projectile-motion": {
    idea: {
      title: "Two motions at once",
      body: "A launched ball moves sideways at a steady speed while gravity speeds it up downwards. Put those two together and you get a curved path, a parabola. The launch speed and angle decide how far it goes.",
      watch: ["45° goes furthest on flat ground (with no air).", "30° and 60° land in the same place.", "Air resistance makes it land shorter and steeper."],
    },
    beats: [
      "At 45° the speed is split equally between sideways and upwards, which gives the best balance of time in the air and speed across.",
      "Measure from the launch point to the centre of the landing mark, or every range you record is off by the same amount.",
      "30° is fast across but short in the air; 60° is slow across but long in the air. The two effects balance exactly, because 30 + 60 = 90.",
      "To hit a target, pick the angle that gives exactly that range. There are usually two angles that work: a low one and a high one.",
      "Air pushes against the ball the whole way, stealing speed. It loses sideways speed so lands shorter, and it falls more steeply at the end.",
    ],
    whatIf: {
      "nothing-to-measure": "There is no landing mark yet, so there is nothing to measure. Launch first.",
      "tape-misread": "Measuring from the wrong point (like the end of the launcher, or the edge of the mark) makes every range wrong by the same amount, so your comparisons between angles go wrong too.",
    },
    explore: {
      "first-launch": [{ q: "What if I double the speed?", a: "The range goes up about four times, not two: faster across AND longer in the air." }],
      measure: [{ q: "What if I measure to the edge of the mark?", a: "You add or lose a few centimetres every time, which matters when comparing close results." }],
      complementary: [{ q: "What if I try 20° and 70°?", a: "They also add to 90°, so they land together too, but both shorter than 45°." }],
      air: [{ q: "What if I use a heavier ball?", a: "Air slows heavy, dense things much less, so the range drops only a little." }],
      moon: [{ q: "What if I launch on the Moon?", a: "Gravity is 6× weaker, so it rises for longer and lands about 6× further away." }],
    },
  },
  "refraction-snells-law": {
    idea: {
      title: "Why light bends in glass",
      body: "Light slows down when it goes from air into glass, and that makes it change direction (refraction). The angles are always measured from the normal, a line at 90° to the glass surface. Snell's law says sin i ÷ sin r is the same number (the refractive index, about 1.5 for glass) for every angle.",
      watch: ["P1 and P2 mark the ray going in; P3 and P4 mark the ray coming out.", "Angles are measured from the normal, not from the glass surface.", "sin i ÷ sin r is about 1.5 every time."],
    },
    beats: [
      "Two pins fix a straight line. Pins far apart fix it accurately; pins close together let a tiny error swing the line a lot.",
      "You see the pins through the glass along the bent ray, so lining up P3 and P4 with their images traces where the light really comes out.",
      "The normal is drawn at 90° to the surface where the ray enters. Every angle in Snell's law is measured from it.",
      "Different angles give different i and r, but the ratio of their sines stays about 1.5. That constant is the refractive index of the glass.",
    ],
    whatIf: {
      "pins-close": "Close pins make a short line: a 1 mm error in either pin tilts the whole ray by several degrees, so your angles and your n come out wrong.",
      "angle-extreme": "Near 0° the ray hardly bends, so i and r are too small to measure well. Near 90° the ray barely gets in. Middle angles give the clearest result.",
      misaligned: "If P3 and P4 are not in line with the images, the traced exit ray is not the real one, so r and e are wrong.",
      "angle-misread": "Measuring from the surface instead of the normal gives 90° minus the true angle. sin i ÷ sin r then comes out wildly wrong, not about 1.5.",
      "p3-before-p1p2": "Without the incoming ray fixed first, there is nothing to line P3 and P4 up with.",
      "trace-early": "The ray is not fixed until all four pins are in, so tracing now would draw the wrong line.",
      "measure-early": "The angles are measured on the traced lines, so trace and draw the normals first.",
      "same-angle": "Repeating nearly the same angle tests nothing new. Spread the angles out to show the ratio stays the same.",
      "wrong-n": "n = sin i ÷ sin r, not i ÷ r. Work it out for each sheet and take the mean.",
    },
    explore: {
      "set-1": [
        { q: "What if I measure the angle from the surface?", a: "You get 90° minus the real angle, and sin i ÷ sin r is nowhere near 1.5." },
        { q: "What if I put the pins very close together?", a: "A tiny wobble of either pin swings the ray a lot, so the angle is unreliable." },
      ],
      "set-2": [{ q: "What if I use the same angle again?", a: "It only repeats your first result. A different angle tests whether the ratio really stays the same." }],
      result: [{ q: "What if I use i ÷ r instead of sin i ÷ sin r?", a: "It is close for small angles but drifts as the angle grows. Only the sines give a constant." }],
    },
  },
  "simple-pendulum": {
    idea: {
      title: "What sets the swing time?",
      body: "A pendulum's period (time for one full swing, there and back) depends on its length and on gravity: T = 2π√(L/g). It does not depend on the mass of the bob, and for small swings not on how far you pull it. So timing pendulums of different lengths lets you measure g.",
      watch: ["Release from a small angle, under 10°.", "Measure the length to the centre of the bob.", "Time 20 swings and divide by 20."],
    },
    beats: [
      "The formula only works for small swings. Above about 10° the swing takes a little longer than the formula says.",
      "The bob's mass acts as if it is all at its centre, so the true length runs from the pivot to the centre of the bob, not to its top.",
      "Your reaction time is about 0.2 s at each end. Spread over 20 swings that error becomes tiny; on one swing it is a big part of the time.",
      "T² is proportional to L, so a longer pendulum swings more slowly. Five lengths give enough points for a reliable straight line.",
      "Plotting T² against L gives a straight line with gradient 4π²/g, so g = 4π² ÷ gradient.",
    ],
    whatIf: {
      "big-swing": "A big swing takes longer than 2π√(L/g) predicts (about 1% longer at 20°, 4% at 45°), so your value of g comes out too small.",
      "length-to-top": "Leaving out the bob's radius makes every L too short, so the gradient and your g are wrong.",
      "length-misread": "A wrong length moves that point off the line. Read the rule at eye level, straight on.",
      "not-swinging": "Timing before release just times you, not the pendulum.",
      "one-swing": "Your reaction time (about 0.2 s) is a big part of one swing (about 1.4 s), so the error could be 15%. Over 20 swings the same 0.2 s is under 1%.",
      "timing-off": "Starting or stopping the watch at the ends of the swing, where the bob is slow, makes the timing vague. The bob zips through the centre, so start and stop there.",
      "wrong-g": "Use the gradient of T² against L: g = 4π² ÷ gradient. Using T instead of T², or one reading, gives the wrong value.",
    },
    explore: {
      "measure-L": [{ q: "What if I measure only the string?", a: "Every length is short by the bob's radius, so g comes out wrong." }],
      release: [{ q: "What if I pull it back to 40°?", a: "Each swing takes a few % longer than the formula says, so g comes out too small." }],
      "time-20": [
        { q: "What if I time just 1 swing?", a: "Your 0.2 s reaction time is about 15% of one swing: a big error. Over 20 swings it is under 1%." },
        { q: "What if I use a heavier bob?", a: "Nothing changes: the period does not depend on mass." },
      ],
      "five-lengths": [{ q: "What if I use only two lengths?", a: "Two points always make a line, so one bad timing would go unnoticed." }],
    },
  },
  "archimedes-principle": {
    idea: {
      title: "Why things feel lighter in water",
      body: "Water pushes up on anything in it. This upward push is called upthrust. Archimedes found that the upthrust equals the weight of the water the object pushes aside (displaces). You test it by weighing the object in air and in water, and catching the water it displaces.",
      watch: ["Weigh the sinker in air first.", "Fill the overflow can and wait for the last drip.", "Lower the sinker until it is fully under water, hanging freely."],
    },
    beats: [
      "The weight in air is the starting point: the loss of weight in water is the upthrust.",
      "Filling to the spout means any extra water must come from the sinker. Waiting for the drip to stop makes sure only the sinker's water is caught.",
      "Fully covered, the sinker displaces its whole volume. If it touches the bottom, the can holds some of its weight and the reading is wrong.",
      "The loss of weight on the spring balance matches the weight of the water in the cylinder: that is Archimedes' principle.",
    ],
    whatIf: {
      "extra-water": "The cylinder caught drips that the sinker never displaced. Reading it while the can still drips over-reads the volume, so the displaced water seems heavier than the upthrust.",
      "can-not-full": "Below the spout, the first water the sinker pushes aside just fills the can up. Less reaches the cylinder, so the displaced water looks too light.",
      "no-cylinder": "The displaced water spilled away before the cylinder was there, so the volume you read is too small.",
      "air-wet": "Weighing it while it is in the water gives the lower, in-water reading, not its true weight.",
      touching: "Resting on the bottom, the can holds up some of the sinker's weight. The balance reads too low, so the upthrust looks too big.",
      partial: "Only part of the sinker was under water, so it displaced less and the upthrust was smaller than for the whole sinker.",
      "balance-misread": "A wrong spring-balance reading makes the upthrust wrong. Read the scale straight on at eye level.",
      "cylinder-misread": "Read the bottom of the curved water surface (the meniscus) at eye level, or the volume is off.",
      "wrong-upthrust": "Upthrust is weight in air minus weight in water.",
      "wrong-displaced": "1 mL of water has a mass of 1 g, so its weight is (mL ÷ 1000) × g newtons.",
    },
    explore: {
      "fill-can": [{ q: "What if I put the cylinder under while it still drips?", a: "It catches extra water, so the volume reads too high and the displaced weight comes out bigger than the upthrust." }],
      immerse: [
        { q: "What if the sinker touches the bottom?", a: "The can supports part of its weight, so the balance reads too low and the upthrust looks too big." },
        { q: "What if it is only half under water?", a: "It displaces half as much water, so the upthrust is about half." },
      ],
      volume: [{ q: "What if I read the top of the meniscus?", a: "You over-read by a mL or two. Always read the bottom of the curve at eye level." }],
    },
  },
  "newtons-second-law": {
    idea: {
      title: "Force makes things speed up",
      body: "Newton's second law says F = m × a: the bigger the force on something, the faster its speed changes (its acceleration), and the heavier it is, the slower it speeds up. You test it by pulling a trolley with different forces while keeping the total mass the same.",
      watch: ["Tilt the runway until a nudged trolley rolls at a steady speed.", "Move masses from the trolley to the hanger, never add new ones.", "Plot acceleration against force: it should be a straight line."],
    },
    beats: [
      "Friction is a hidden force pulling backwards. If you leave it in, part of your pull is used up fighting it and every acceleration comes out too small.",
      "A steady speed means the forces are balanced, so from now on the only unbalanced force is the hanging weight.",
      "Speed at the first gate and the second gate, plus the time between them, give the acceleration: a = change in speed ÷ time.",
      "The hanger also gets pulled along, so it is part of the moving mass. Moving masses across keeps the total the same, so only the force changes.",
      "A straight line through the origin means a is proportional to F: double the push, double the speeding up.",
      "Rearranged, a = F ÷ m, so the gradient of a against F is 1 ÷ m. Turning the gradient upside down gives the mass being accelerated.",
    ],
    whatIf: {
      friction: "With friction left in, some of the force is used up against it. Every acceleration is too small and the line misses the origin, cutting the force axis instead.",
      "mass-changed": "Adding a new mass to the hanger changes the total mass as well as the force, so the two effects mix and the graph curves instead of being straight.",
      "gate-misread": "A wrong light-gate reading puts that point off the line. Read the gate display carefully and repeat any run that looks odd.",
      "wrong-mass": "The gradient of a against F is 1 ÷ m, so m = 1 ÷ gradient. Using the gradient itself gives a number far too small.",
    },
    explore: {
      compensate: [{ q: "What if I don't tilt the runway?", a: "Friction steals part of each pull, so every acceleration is too small and the line doesn't pass through the origin." }],
      "first-run": [{ q: "What if the card is longer?", a: "The gates time it over a longer distance, which averages the speed better. Just enter the right card length." }],
      "five-forces": [
        { q: "What if I add new masses to the hanger instead of moving them?", a: "The total mass grows too, so the acceleration rises less than it should and the graph bends." },
        { q: "What if I use only one force?", a: "One point can't show a pattern. You need several to see that a rises in step with F." },
      ],
      result: [{ q: "What if the line doesn't go through zero?", a: "That usually means friction wasn't fully cancelled. Re-tilt the runway and repeat." }],
    },
  },
  "specific-heat-capacity": {
    idea: {
      title: "How much energy does it take to warm something?",
      body: "Different materials need different amounts of energy to warm up. The specific heat capacity c is the energy needed to warm 1 kg by 1 °C. You heat a block with a known power, measure how much its temperature rises, and use E = m × c × Δθ to find c.",
      watch: ["Put a drop of oil in the thermometer hole and wrap the block in insulation.", "Read the start temperature before switching on.", "Take a reading every minute for 10 minutes."],
    },
    beats: [
      "Heater and thermometer sit inside the block. The oil fills the air gap so heat reaches the thermometer quickly and the reading keeps up with the block.",
      "Without insulation, heat leaks into the room. The block warms less, so c comes out too big.",
      "The temperature rise is measured from the start, so the start reading must come before the heater goes on.",
      "Power is the energy per second. A voltmeter and ammeter give it: P = V × I.",
      "Equal rises each minute show the heater is delivering a steady power, so the energy is just power × time.",
      "Energy = voltage × current × time, all in volts, amps and seconds. 10 minutes is 600 s.",
      "Rearranging E = m c Δθ gives c = E ÷ (m × Δθ). Real aluminium is about 900 J/kg°C; heat lost to the room makes your answer a bit higher.",
    ],
    whatIf: {
      "heater-in-air": "In air the heater has nothing to pass its heat to. It gets hot enough to burn and can crack, so always put it in the block first.",
      "no-insulation": "Heat escapes into the room. The block warms less for the same energy, so your value of c comes out too big.",
      "no-oil": "Air in the hole is a poor conductor, so the thermometer lags behind the block. The rise you read is too small and c comes out too big.",
      "no-start-temp": "Without a start temperature you can't work out how much it warmed, so c can't be found.",
      "meter-off": "With the heater off the meters read zero, which tells you nothing about the power.",
      "meter-misread": "A wrong voltage or current makes the power, the energy and c all wrong by the same fraction.",
      "thermo-misread": "Read the thermometer at eye level, straight on. A misread changes the temperature rise and so c.",
      "thermo-out": "Out of the block the thermometer measures the air, not the aluminium.",
      "nothing-to-read": "Switch on and wait for a reading before recording.",
      "wrong-energy": "E = V × I × t with t in seconds. Using minutes makes E 60 times too small.",
      "wrong-c": "c = E ÷ (m × Δθ), with m in kg and Δθ the rise, not the final temperature.",
    },
    explore: {
      setup: [
        { q: "What if I skip the insulation?", a: "More heat leaks out, the block warms less, and c comes out too high." },
        { q: "What if I leave out the oil?", a: "The thermometer reads behind the block, so the rise looks smaller and c too big." },
      ],
      start: [{ q: "What if I switch on before reading the start temperature?", a: "Some of the rise is missed, so Δθ is too small and c is too big." }],
      readings: [{ q: "What if I heat for only 2 minutes?", a: "The rise is small, so a 0.5 °C reading error is a big percentage. Longer heating gives a more accurate c." }],
      result: [{ q: "Why is my answer above 900?", a: "Some heat still escaped and warmed the heater and thermometer, so the block got less energy than you counted." }],
    },
  },
};
