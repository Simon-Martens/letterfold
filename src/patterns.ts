export type Pattern =
  | "letter"
  | "half"
  | "accordion"
  | "cross"
  | "double-cross"
  | "fivefold"
  | "lenz-1776";
export const patterns = {
  "lenz-1776": {
    name: "Lenz wrapper · 1776 reconstruction",
    description:
      "Photo-based estimate: side creases at 20% / 72%; horizontal creases at 38% / 79%. Proposed order, folded behind the address panel. Long upper flap first; short lower flap closes on top. Tears are not modeled.",
    steps: [
      "Fold left margin behind",
      "Fold right margin behind",
      "Fold long upper flap behind",
      "Close short lower flap on top",
    ],
  },
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
