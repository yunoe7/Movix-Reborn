/**
 * Une pause ne doit être imposée que par une majorité absolue des participants
 * présents. Une moitié exacte (par exemple 1 voix sur 2) n'est pas une majorité.
 */
export function isPauseVotePassed(yesVotes, totalParticipants) {
  if (!Number.isFinite(totalParticipants) || totalParticipants <= 0) return false;
  return yesVotes > totalParticipants / 2;
}
