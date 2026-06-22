const mongoose = require('mongoose');

const batsmanSchema = new mongoose.Schema({
  name:    { type: String, required: true },
  runs:    { type: Number, default: 0 },
  balls:   { type: Number, default: 0 },
  fours:   { type: Number, default: 0 },
  sixes:   { type: Number, default: 0 },
  status:  { type: String, default: 'yet to bat' }, // 'yet to bat' | 'batting' | 'out' | 'retired hurt'
  outDesc: { type: String, default: '' },
}, { _id: false });

const bowlerSchema = new mongoose.Schema({
  name:    { type: String, required: true },
  overs:   { type: Number, default: 0 },
  balls:   { type: Number, default: 0 },
  maidens: { type: Number, default: 0 },
  runs:    { type: Number, default: 0 },
  wickets: { type: Number, default: 0 },
}, { _id: false });

const ballSchema = new mongoose.Schema({
  over:        { type: Number, default: 0 },
  ball:        { type: Number, default: 0 },
  runs:        { type: Number, default: 0 },
  isWicket:    { type: Boolean, default: false },
  isWide:      { type: Boolean, default: false },
  isNoBall:    { type: Boolean, default: false },
  isBye:       { type: Boolean, default: false },
  isLegBye:    { type: Boolean, default: false },
  batsmanName: { type: String, default: '' },
  bowlerName:  { type: String, default: '' },
  desc:        { type: String, default: '' },
}, { _id: false });

const fowSchema = new mongoose.Schema({
  score:   { type: Number, default: 0 },
  over:    { type: String, default: '' },
  batsman: { type: String, default: '' },
}, { _id: false });

const inningsSchema = new mongoose.Schema({
  battingTeam:  { type: String, default: '' },
  bowlingTeam:  { type: String, default: '' },
  runs:         { type: Number, default: 0 },
  wickets:      { type: Number, default: 0 },
  overs:        { type: Number, default: 0 },
  balls:        { type: Number, default: 0 },
  target:       { type: Number, default: 0 },
  extras: {
    wides:   { type: Number, default: 0 },
    noBalls: { type: Number, default: 0 },
    byes:    { type: Number, default: 0 },
    legByes: { type: Number, default: 0 },
  },
  striker:      { type: String, default: '' },
  nonStriker:   { type: String, default: '' },
  currentBowler:{ type: String, default: '' },
  isCompleted:  { type: Boolean, default: false },
  batsmen:      { type: [batsmanSchema], default: [] },
  bowlers:      { type: [bowlerSchema], default: [] },
  ballByBall:   { type: [ballSchema], default: [] },
  fallOfWickets:{ type: [fowSchema], default: [] },
}, { _id: false });

const cricketMatchSchema = new mongoose.Schema({
  title:        { type: String, required: true, trim: true },
  teamA:        { type: String, required: true, trim: true },
  teamB:        { type: String, required: true, trim: true },
  totalOvers:   { type: Number, default: 20 },
  playersPerSide:{ type: Number, default: 11 },
  venue:        { type: String, default: '' },
  teamAPlayers: { type: [String], default: [] },
  teamBPlayers: { type: [String], default: [] },
  tossWinner:   { type: String, default: '' },
  tossElected:  { type: String, default: '' }, // 'bat' | 'field'
  status:       { type: String, default: 'setup' }, // setup | live | innings_break | completed | abandoned
  currentInnings:{ type: Number, default: 1 },
  innings:      { type: [inningsSchema], default: [] },
  result:       { type: String, default: '' },
  creatorToken: { type: String, default: '' },
  creatorName:  { type: String, default: '' },
  scorerToken:  { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.CricketMatch || mongoose.model('CricketMatch', cricketMatchSchema);
