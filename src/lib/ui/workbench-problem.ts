export type WorkbenchProblem = {
  text: string;
  tone: "danger" | "warning";
  href?: string;
  drawer?: "readings" | "billing-details";
  focus?: string;
  // A name told apart by its end (a meter serial): cut in the middle,
  // keeping this many trailing digits.
  keepEnd?: number;
  // Fixed only outside the drawer (tariffs, meters): listed first.
  config?: boolean;
  // Guidance too long for the line: tooltip and screen readers.
  detail?: string;
};
