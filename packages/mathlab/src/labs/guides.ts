import type { SimGuide } from "@labscape/physics";

/** Beginner guidance for the maths experiments (see SimGuide in @labscape/physics). */
export const MATHS_GUIDES: Record<string, SimGuide> = {
  "quadratic-explorer": {
    idea: {
      title: "What do a, b and c do to a parabola?",
      body: "y = ax² + bx + c draws a U-shaped curve called a parabola. a decides which way it opens and how narrow it is, b slides the turning point sideways, and c moves the whole curve up and down. The roots are where it crosses the x-axis (y = 0).",
      watch: ["The vertex (turning point) moves as b and c change.", "When the curve just touches the x-axis, the two roots become one.", "A negative a flips the U upside down."],
    },
    beats: [
      "The vertex is at x = −b ÷ 2a. With a = 1 and b = −4 that is x = 2; then c lifts or lowers it to y = −3.",
      "Raising c lifts the U until it only touches the axis: the two roots squeeze together into one repeated root.",
      "Lift it higher and it misses the x-axis completely: there are no real roots, only a pair of complex ones.",
      "A negative a turns the U into an upside-down U (∩), with a highest point instead of a lowest one.",
    ],
    whatIf: {
      "wrong-root": "A root is an x value where y = 0, so it must be where the curve crosses the x-axis. Reading the y-intercept or the vertex instead gives a different number.",
    },
    explore: {
      vertex: [{ q: "What if I change b only?", a: "The vertex slides along a curved path; the U keeps its shape." }],
      touch: [{ q: "What if c goes just a bit higher?", a: "The curve lifts off the axis and the roots disappear (they become complex)." }],
      flip: [{ q: "What if a = 0?", a: "The x² term vanishes and it becomes a straight line, not a parabola." }],
    },
  },
  "balance-equations": {
    idea: {
      title: "An equation is a balance",
      body: "The = sign means both sides weigh the same. You can do anything you like to an equation, as long as you do the same to both sides, and it stays balanced. Keep going until x is alone on one side.",
      watch: ["Take the same amount off both pans.", "Divide both sides by the same number.", "Check by putting your answer back in."],
    },
    beats: [
      "Taking 4 off both pans keeps them level, and leaves only the x-bags with the numbers on one side.",
      "Dividing both sides by 3 shares each side into three equal parts: one x-bag balances 5.",
      "When x appears on both sides, take an x-bag off both: it cancels from one side.",
      "Now it is a one-step problem: take 5 off both sides to leave x = 4.",
    ],
    whatIf: {
      "one-side": "Changing only one side tips the balance: the two sides are no longer equal, so any answer you get from here is wrong. Undo it and do the same to both sides.",
      "bad-op": "Dividing by zero has no answer, so it cannot keep the balance.",
      "wrong-x": "Put your answer back into both sides of the original equation. If they do not come out equal, it is not the solution.",
    },
    explore: {
      "isolate-1": [{ q: "What if I take 4 off the left only?", a: "The scale tips: the sides are not equal any more, so you are solving a different (wrong) equation." }],
      "solve-1": [{ q: "What if I subtract 3 instead of dividing by 3?", a: "3x − 3 is not x. To undo times 3 you divide by 3." }],
      "collect-2": [{ q: "What if I take x off one side only?", a: "The balance tips. Do it to both sides and the x cancels neatly on one side." }],
    },
  },
  "unit-circle-trig": {
    idea: {
      title: "Sine and cosine are just height and width",
      body: "Put a point on a circle of radius 1 and turn it by an angle. How high the point is is the sine of the angle; how far across it is is the cosine. That is all sin and cos are.",
      watch: ["At 30° the point is half way up: sin 30° = 0.5.", "Past 90° the point is on the left, so cos is negative.", "One full turn draws one whole sine wave."],
    },
    beats: [
      "The radius is 1, so the height of the point is the sine directly. At 30° it is exactly 0.5.",
      "Left of the middle, 'across' is negative, so cosine is negative in the second and third quarters.",
      "At 45° the point is equally high and across, so sin 45° = cos 45° (about 0.707).",
      "Plot the height against the angle as the point goes round once and you draw a sine wave: it repeats every 360°.",
    ],
    whatIf: {
      sign: "The size is right but the sign is wrong. Left of the middle cos is negative; below the middle sin is negative.",
      misread: "Sine is the height of the point (up the y-axis); cosine is how far across (along the x-axis). Swapping them gives the wrong value.",
      "not-equal": "sin = cos only where the height equals the width, at 45° (and 225°).",
    },
    explore: {
      thirty: [{ q: "What if I read the width instead?", a: "That is cos 30° (about 0.866), not sin 30°." }],
      quadrant: [{ q: "What if the angle is 200°?", a: "The point is left and below: both sin and cos are negative." }],
      radians: [{ q: "What if I mix up degrees and radians?", a: "60 radians is almost 10 full turns, so sin 60 in radians is a totally different number from sin 60°." }],
    },
  },
  "derivative-as-slope": {
    idea: {
      title: "How steep is a curve at one point?",
      body: "A straight line has one slope everywhere, but a curve's steepness keeps changing. To find it at one point, draw a line through that point and a second point a distance h away (a secant), then shrink h. The line swings into the tangent, and its slope is the derivative.",
      watch: ["The secant joins two points on the curve.", "Shrinking h turns it into the tangent.", "Where the tangent is flat, the derivative is 0."],
    },
    beats: [
      "A secant through two nearby points gives the average steepness between them.",
      "As h shrinks, the second point slides towards the first and the secant becomes the tangent: the steepness at exactly that point.",
      "The tangent's rise over run at x = 2 is 9: that is f′(2).",
      "At a turning point the curve is flat for an instant, so the tangent is horizontal and the slope is 0.",
    ],
    whatIf: {
      "secant-not-tangent": "With a big h you measure the average slope between two points, not the slope at one point, so your value is off.",
      "slope-misread": "Slope = rise ÷ run of the tangent line. Reading the y-value of the curve instead gives a different number.",
      "not-flat": "Where the tangent is not horizontal the slope is not 0, so that is not a turning point.",
      "wrong-derivative": "Differentiate each term: xⁿ becomes n xⁿ⁻¹. Check it against the slopes you measured.",
    },
    explore: {
      limit: [{ q: "What if h stays big?", a: "You get the average slope over a chunk of the curve, not the slope at the point." }],
      flat: [{ q: "What if I pick the top of a hill?", a: "That is also a flat point: the slope is 0 there too." }],
    },
  },
  "riemann-sums": {
    idea: {
      title: "Area under a curve from rectangles",
      body: "We can find the area under a curve by filling it with thin rectangles and adding up their areas. A few wide rectangles miss bits or overshoot; more, thinner rectangles get closer and closer to the true area.",
      watch: ["Left rectangles sit under this rising curve; right ones poke above it.", "Doubling n makes the gaps smaller.", "The sums close in on one number: the exact area."],
    },
    beats: [
      "Each left rectangle takes its height from its left edge. On a rising curve that is the lowest point, so the sum is too small.",
      "Right rectangles use the right edge, the highest point here, so they overshoot.",
      "Using the midpoint balances the over and under bits. Each time n doubles, each rectangle splits in two and the error shrinks.",
      "As n grows the sums settle on 8/3: that limit is the integral, the exact area.",
    ],
    whatIf: {
      "sum-misread": "Each rectangle's area is width × height. Add them all; a misread adds error to your comparison.",
      "wrong-area": "The exact area is the value the sums settle on as n grows, not any single sum with a small n.",
    },
    explore: {
      "left-4": [{ q: "What if I use only 1 rectangle?", a: "One rectangle is a very rough guess: the error is huge." }],
      converge: [{ q: "What if n = 1000?", a: "The sum is within a tiny fraction of the exact area: the gaps are almost invisible." }],
    },
  },
  "dice-probability": {
    idea: {
      title: "Chance settles down in the long run",
      body: "A fair coin lands heads with probability ½, but ten flips can easily give 7 heads. The more times you repeat it, the closer the fraction of heads gets to 0.5. With two dice some totals are more likely than others because there are more ways to make them.",
      watch: ["Ten flips: far from half.", "A thousand flips: close to 0.5.", "Two-dice totals pile up in the middle at 7."],
    },
    beats: [
      "Ten flips is too few: luck dominates, so the fraction of heads can be far from 0.5.",
      "With 1000 flips the lucky streaks cancel out, so the relative frequency settles near the true probability.",
      "Totals near 7 can be made in many ways (1+6, 2+5, 3+4, ...), while 2 and 12 have only one way each.",
      "7 has six ways out of 36, more than any other total, so it is the most likely.",
    ],
    whatIf: {
      "freq-misread": "Relative frequency = number of heads ÷ number of flips. Using the count instead of the fraction gives a number that is not a probability.",
      "wrong-mode": "The mode is the total that happens most. Count the ways to make each total: 7 has the most (6 out of 36).",
    },
    explore: {
      "ten-flips": [{ q: "What if I flip 10 times again?", a: "You will likely get a different fraction: small samples jump around." }],
      "dice-sum": [{ q: "What if I use one die?", a: "Each number 1 to 6 is equally likely: no pile-up in the middle." }],
    },
  },
  "graph-transformations": {
    idea: {
      title: "Moving and stretching graphs",
      body: "In y = a·f(b(x − c)) + d, four numbers change the graph's position and shape without changing what kind of graph it is. Numbers outside the function change y-values (up and down). Numbers inside change x-values (left and right), and they feel backwards.",
      watch: ["d slides the graph up or down.", "c slides it right when c is positive, the opposite of what you might expect.", "A negative a flips the graph upside down; b squashes or stretches it sideways."],
    },
    beats: [
      "Adding d to every y-value lifts every point by the same amount, so the shape stays the same and just moves up.",
      "To get the same y-value as before, x now has to be 2 bigger, so every point appears 2 further to the right. That's why inside changes feel backwards.",
      "Multiplying every y-value by −1 swaps positive and negative, mirroring the graph in the x-axis.",
      "With b = 2 the input runs twice as fast, so everything happens in half the distance and the graph is squashed towards the y-axis.",
      "Apply the changes one at a time: flip, then slide sideways, then lift. Following one point, like the vertex, shows where the whole graph goes.",
    ],
    whatIf: {
      "no-match": "Your graph doesn't sit on the dashed target yet. Change one slider at a time and watch one point, such as the vertex, to see which number moves it where.",
    },
    explore: {
      up: [{ q: "What if d is negative?", a: "The graph slides down by that amount instead." }],
      right: [{ q: "What if I use c = −2?", a: "f(x + 2) slides the graph LEFT by 2: the sign inside the bracket works backwards." }],
      flip: [{ q: "What if a = 2 instead of −1?", a: "The graph stretches upwards to twice as tall, without flipping." }],
      squash: [{ q: "What if b = 0.5?", a: "The graph stretches sideways to twice as wide: one wave now takes twice the distance." }],
      combo: [{ q: "Does the order matter?", a: "For this form, apply the inside changes (b, c) before the outside ones (a, d) and you'll land in the right place." }],
    },
  },
};
