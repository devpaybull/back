export type EnergyPlan =
  | { action: 'ready' }
  | { action: 'delegate'; balanceSun: string }
  | { action: 'burn'; burnSun: string }
  | { action: 'wait' };
