export function createLimitRounds(maxRounds: number) {
	let round = 0
	return {
		done() {
			return round >= maxRounds
		},
		next() {
			round++
		},
		reset() {
			round = 0
		}
	}
}
