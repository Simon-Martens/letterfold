export type Pattern =
  "letter" | "half" | "accordion" | "cross" | "double-cross" | "fivefold";
export const patterns = {
  letter: {
    name: "The letter fold",
    description: "Two inward folds. The second flap closes over the first.",
    steps: ["Bring the bottom up", "Bring the top down"],
  },
  half: {
    name: "The half fold",
    description: "One crease, two halves. The simplest place to begin.",
    steps: ["Fold the upper half"],
  },
  accordion: {
    name: "The accordion fold",
    description: "Two opposing folds. A small study in peaks and valleys.",
    steps: ["Bring the bottom up", "Fold the top away"],
  },
  cross: {
    name: "The cross fold · 2 folds",
    description:
      "Fold right to left, then top to bottom. A packet with four layers.",
    steps: ["Fold right to left", "Fold top to bottom"],
  },
  "double-cross": {
    name: "The double cross · 4 folds",
    description:
      "Fold twice in each direction, carrying the whole stack with every fold.",
    steps: [
      "Fold right to left",
      "Fold top to bottom",
      "Fold the packet left again",
      "Fold the packet down again",
    ],
  },
  fivefold: {
    name: "The small packet · 5 folds",
    description:
      "Two folds across the sheet, then three more alternating folds. Thirty-two layers.",
    steps: [
      "Fold right to left",
      "Fold top to bottom",
      "Fold the packet left",
      "Fold the packet down",
      "Close the packet left again",
    ],
  },
} as const;
export const packetAxes = {
  cross: [0, 1],
  "double-cross": [0, 1, 0, 1],
  fivefold: [0, 1, 0, 1, 0],
} as const;
