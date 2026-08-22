// Generated from work/levels.tsv by work/sync-levels.mjs. Do not edit by hand.
export const LEVELS_SHEET = `# Level sheet. One row is one level. Edit here, then run: npm run levels
# layers: layers separated by |, rows inside a layer by / (top row first), . is an empty cell
# one letter per block: R G Y B P O. Case is ignored.
# batch_blocks: how many claimed blocks may sit in the reserve at once. Never below the level's biggest cluster.
# leave goal_order and goal_split empty to let the game work them out. An empty column uses the default.
level	name	dims	layers	goal_order	goal_split	goal_slots	batch_blocks	shot_limit	notes
1	Prism 4x3x2	4x3x2	PPPO/YYYY/RRRO|RRRO/BBBB/GGGG	R,G,Y,B,P,O					the prototype original level
2	Interleaved layers	4x2x2	BBRR/GGYY|RRBB/YYGG	B,R,G,Y					example - replace with a real level
3	Split purple goal	3x3x2	PPP/OOO/RRR|RRR/PPP/OOO	P,O,R	P:3+3				example - shows what goal_split does
`;
