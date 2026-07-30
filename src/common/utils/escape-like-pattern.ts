const LIKE_WILDCARDS = /[\\%_]/g;

export const escapeLikePattern = (term: string): string =>
  term.replace(LIKE_WILDCARDS, (wildcard) => `\\${wildcard}`);
