const mongoose = require('mongoose');

const ballSchema = new mongoose.Schema({
  over: Number,
  ball: Number,
  runs: { type: Number, default: 0 },
  extras: { type: Number, default: 0 },
  isWicket: { type: Boolean, default: false },
  isWide: { type: Boolean, default: false },
  isNoBall: { type: Boolean, default: false },
  isBye: { type: Boolean, default: false },
  isLegBye: { type: Boolean, default: false },
  batsmanName: String,
  bowlerName: String,
  desc: String
}, { _id: false });

const batsmanSchema = new mongoose.Schema({
  name: { type: String, required: true },
  runs: { type: Number, default: 0 },
  balls: { type: Number, default: 0 },
  fours: { type: Number, default: 0 },
  sixes: { type: Number, default: 0 },
  status: { type: String, enum: ['batting', 'out', 'yet to bat', 'retired hurt'], default: 'yet to bat' },
  outDesc: { type: String, default: '' }
}, { _id: false });

const bowlerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  overs: { type: Number, default: 0 },
  balls: { type: Number, default: 0 },
  maidens: { type: Number, default: 0 },
  runs: { type: Number, default: 0 },
  wickets: { type: Number, default: 0 }
}, { _id: false });

const inningsSchema = new mongoose.Schema({
  battingTeam: String,
  bowlingTeam: String,
  runs: { type: Number, default: 0 },
  wickets: { type: Number, default: 0 },
  overs: { type: Number, default: 0 },
  balls: { type: Number, default: 0 },
  extras: {
    wides: { type: Number, default: 0 },
    noBalls: { type: Number, default: 0 },
    byes: { type: Number, default: 0 },
    legByes: { type: Number, default: 0 }
  },
  striker: { type: String, default: '' },
  nonStriker: { type: String, default: '' },
  currentBowler: { type: String, default: '' },
  batsmen: [batsmanSchema],
  bowlers: [bowlerSchema],
  ballByBall: [ballSchema],
  fallOfWickets: [{ score: Number, over: String, batsman: String }],
  target: { type: Number, default: 0 },
  isCompleted: { type: Boolean, default: false }
}, { _id: false });

const cricketMatchSchema = new mongoose.Schema({
  title: { type: String, required: true },
  teamA: { type: String, required: true },
  teamB: { type: String, required: true },
  totalOvers: { type: Number, required: true },
  playersPerSide: { type: Number, default: 11 },
  teamAPlayers: [{ type: String }],
  teamBPlayers: [{ type: String }],
  venue: { type: String, default: '' },
  tossWinner: { type: String, default: '' },
  tossElected: { type: String, enum: ['bat', 'bowl', ''], default: '' },
  status: { type: String, enum: ['setup', 'live', 'innings_break', 'completed', 'abandoned'], default: 'setup' },
  currentInnings: { type: Number, default: 1 },
  innings: [inningsSchema],
  result: { type: String, default: '' },
  creatorToken: { type: String, required: true },
  creatorName: { type: String, default: '' },
  scorerToken: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('CricketMatch', cricketMatchSchema);
