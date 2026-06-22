const express = require('express');
const router = express.Router();
const CricketMatch = require('../models/CricketMatch');
const Visitor = require('../models/Visitor');

// Verify visitor has a registered profile (name + phone)
async function requireRegisteredVisitor(token) {
  if (!token) return null;
  const v = await Visitor.findOne({ visitorToken: token });
  if (!v || !v.visitorName || !v.registeredPhone) return null;
  return v;
}

// GET /api/cricket/matches — list active & recent matches
router.get('/matches', async (req, res) => {
  try {
    const matches = await CricketMatch.find(
      { status: { $ne: 'abandoned' } },
      { 'innings.ballByBall': 0 }
    ).sort({ updatedAt: -1 }).limit(20);
    res.json(matches);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /api/cricket/matches/:id — full match detail
router.get('/matches/:id', async (req, res) => {
  try {
    const match = await CricketMatch.findById(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found' });
    res.json(match);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/cricket/matches — create match
router.post('/matches', async (req, res) => {
  try {
    const { visitorToken, title, teamA, teamB, totalOvers, playersPerSide, venue, teamAPlayers, teamBPlayers } = req.body;
    const visitor = await requireRegisteredVisitor(visitorToken);
    if (!visitor) return res.status(403).json({ message: 'Match बनाने के लिए प्रोफ़ाइल में नाम और मोबाइल नंबर जरूरी है।' });

    const match = new CricketMatch({
      title, teamA, teamB,
      totalOvers: Math.max(1, parseInt(totalOvers) || 20),
      playersPerSide: Math.max(2, parseInt(playersPerSide) || 11),
      teamAPlayers: Array.isArray(teamAPlayers) ? teamAPlayers.map(p => String(p).trim()).filter(Boolean) : [],
      teamBPlayers: Array.isArray(teamBPlayers) ? teamBPlayers.map(p => String(p).trim()).filter(Boolean) : [],
      venue: venue || '',
      creatorToken: visitorToken,
      creatorName: visitor.visitorName,
      scorerToken: visitorToken,
      innings: []
    });
    await match.save();
    res.status(201).json(match);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/cricket/matches/:id/toss — set toss & start innings
router.patch('/matches/:id/toss', async (req, res) => {
  try {
    const { visitorToken, tossWinner, tossElected } = req.body;
    const match = await CricketMatch.findById(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found' });
    if (match.scorerToken !== visitorToken) return res.status(403).json({ message: 'Scorer only' });

    const battingTeam = tossElected === 'bat' ? tossWinner : (tossWinner === match.teamA ? match.teamB : match.teamA);
    const bowlingTeam = battingTeam === match.teamA ? match.teamB : match.teamA;

    match.tossWinner = tossWinner;
    match.tossElected = tossElected;
    match.status = 'live';
    match.innings = [{ battingTeam, bowlingTeam, batsmen: [], bowlers: [], ballByBall: [], fallOfWickets: [] }];
    match.currentInnings = 1;
    match.updatedAt = new Date();
    await match.save();
    res.json(match);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/cricket/matches/:id/players — set players for current innings
router.patch('/matches/:id/players', async (req, res) => {
  try {
    const { visitorToken, batsmen, bowlers, striker, nonStriker, currentBowler } = req.body;
    const match = await CricketMatch.findById(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found' });
    if (match.scorerToken !== visitorToken) return res.status(403).json({ message: 'Scorer only' });

    const idx = match.currentInnings - 1;
    const inn = match.innings[idx];
    if (batsmen) inn.batsmen = batsmen.map(n => ({ name: n, runs: 0, balls: 0, fours: 0, sixes: 0, status: 'yet to bat', outDesc: '' }));
    if (bowlers) inn.bowlers = bowlers.map(n => ({ name: n, overs: 0, balls: 0, maidens: 0, runs: 0, wickets: 0 }));
    if (striker) { inn.striker = striker; const b = inn.batsmen.find(x => x.name === striker); if (b) b.status = 'batting'; }
    if (nonStriker) { inn.nonStriker = nonStriker; const b = inn.batsmen.find(x => x.name === nonStriker); if (b) b.status = 'batting'; }
    if (currentBowler) inn.currentBowler = currentBowler;

    match.updatedAt = new Date();
    match.markModified('innings');
    await match.save();
    res.json(match);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/cricket/matches/:id/ball — record a ball
router.post('/matches/:id/ball', async (req, res) => {
  try {
    const { visitorToken, runs, isWicket, isWide, isNoBall, isBye, isLegBye, outDesc, newBatsman, desc } = req.body;
    const match = await CricketMatch.findById(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found' });
    if (match.scorerToken !== visitorToken) return res.status(403).json({ message: 'Scorer only' });
    if (match.status !== 'live') return res.status(400).json({ message: 'Match live नहीं है' });

    const idx = match.currentInnings - 1;
    const inn = match.innings[idx];
    const r = parseInt(runs) || 0;
    const isLegal = !isWide && !isNoBall;

    // Build ball record
    const ballRecord = {
      over: inn.overs,
      ball: inn.balls + (isLegal ? 1 : 0),
      runs: r,
      extras: (isWide || isNoBall) ? 1 : 0,
      isWicket: !!isWicket,
      isWide: !!isWide,
      isNoBall: !!isNoBall,
      isBye: !!isBye,
      isLegBye: !!isLegBye,
      batsmanName: inn.striker,
      bowlerName: inn.currentBowler,
      desc: desc || _buildDesc(r, isWicket, isWide, isNoBall, isBye, isLegBye, inn.striker, outDesc)
    };
    inn.ballByBall.push(ballRecord);

    // Update innings totals
    const totalRuns = r + (isWide || isNoBall ? 1 : 0) + (isBye || isLegBye ? r : 0);
    inn.runs += (isWide || isNoBall ? 1 : 0) + r;

    // Extras
    if (isWide) inn.extras.wides += 1 + r;
    if (isNoBall) inn.extras.noBalls += 1;
    if (isBye) inn.extras.byes += r;
    if (isLegBye) inn.extras.legByes += r;

    // Update batsman (only on legal balls or no-ball)
    const striker = inn.batsmen.find(b => b.name === inn.striker);
    if (striker && !isWide) {
      if (!isBye && !isLegBye) striker.runs += r;
      striker.balls += isLegal || isNoBall ? 1 : 0;
      if (r === 4 && !isBye && !isLegBye) striker.fours++;
      if (r === 6 && !isBye && !isLegBye) striker.sixes++;
    }

    // Update bowler
    const bowler = inn.bowlers.find(b => b.name === inn.currentBowler);
    if (bowler) {
      if (!isBye && !isLegBye) bowler.runs += r + (isWide || isNoBall ? 1 : 0);
      if (isLegal) {
        bowler.balls++;
        if (bowler.balls === 6) { bowler.overs++; bowler.balls = 0; }
      }
      if (isWicket && !['run out'].includes(outDesc)) bowler.wickets++;
    }

    // Advance legal balls / overs
    if (isLegal) {
      inn.balls++;
      if (inn.balls === 6) {
        // Check maiden
        const overBalls = inn.ballByBall.filter(b => b.over === inn.overs && !b.isWide && !b.isNoBall);
        const overRuns = overBalls.reduce((s, b) => s + b.runs, 0);
        if (overRuns === 0 && !isWicket && bowler) bowler.maidens++;
        inn.overs++;
        inn.balls = 0;
        // Rotate strike at end of over
        [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
      }
    }

    // Wicket handling
    if (isWicket) {
      inn.wickets++;
      if (striker) { striker.status = 'out'; striker.outDesc = outDesc || 'out'; }
      inn.fallOfWickets.push({ score: inn.runs, over: `${inn.overs}.${inn.balls}`, batsman: inn.striker });
      inn.striker = newBatsman || '';
      if (newBatsman) {
        const nb = inn.batsmen.find(b => b.name === newBatsman);
        if (nb) nb.status = 'batting'; else inn.batsmen.push({ name: newBatsman, runs: 0, balls: 0, fours: 0, sixes: 0, status: 'batting', outDesc: '' });
      }
    }

    // Rotate strike on odd runs (legal ball)
    if (isLegal && !isWicket && r % 2 === 1 && inn.balls !== 0) {
      [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
    }

    // Check innings end
    const maxWickets = match.playersPerSide - 1;
    const oversUp = inn.overs >= match.totalOvers && inn.balls === 0;
    const allOut = inn.wickets >= maxWickets;
    const chased = match.currentInnings === 2 && inn.target > 0 && inn.runs >= inn.target;

    if (oversUp || allOut || chased) {
      inn.isCompleted = true;
      if (match.currentInnings === 1) {
        // Start 2nd innings
        const target = inn.runs + 1;
        const battingTeam2 = inn.bowlingTeam;
        const bowlingTeam2 = inn.battingTeam;
        match.status = 'innings_break';
        match.innings.push({ battingTeam: battingTeam2, bowlingTeam: bowlingTeam2, target, batsmen: [], bowlers: [], ballByBall: [], fallOfWickets: [] });
      } else {
        match.status = 'completed';
        match.result = _calcResult(match);
      }
    }

    match.updatedAt = new Date();
    match.markModified('innings');
    await match.save();
    res.json(match);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/cricket/matches/:id/start-innings2 — scorer starts 2nd innings
router.patch('/matches/:id/start-innings2', async (req, res) => {
  try {
    const { visitorToken, striker, nonStriker, currentBowler } = req.body;
    const match = await CricketMatch.findById(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found' });
    if (match.scorerToken !== visitorToken) return res.status(403).json({ message: 'Scorer only' });

    match.currentInnings = 2;
    match.status = 'live';
    const inn = match.innings[1];
    if (striker) { inn.striker = striker; const b = inn.batsmen.find(x => x.name === striker); if (b) b.status = 'batting'; else inn.batsmen.push({ name: striker, runs: 0, balls: 0, fours: 0, sixes: 0, status: 'batting', outDesc: '' }); }
    if (nonStriker) { inn.nonStriker = nonStriker; const b = inn.batsmen.find(x => x.name === nonStriker); if (b) b.status = 'batting'; else inn.batsmen.push({ name: nonStriker, runs: 0, balls: 0, fours: 0, sixes: 0, status: 'batting', outDesc: '' }); }
    if (currentBowler) { inn.currentBowler = currentBowler; inn.bowlers.push({ name: currentBowler, overs: 0, balls: 0, maidens: 0, runs: 0, wickets: 0 }); }

    match.updatedAt = new Date();
    match.markModified('innings');
    await match.save();
    res.json(match);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// DELETE /api/cricket/matches/:id/ball — undo last ball
router.delete('/matches/:id/ball', async (req, res) => {
  try {
    const { visitorToken } = req.body;
    const match = await CricketMatch.findById(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found' });
    if (match.scorerToken !== visitorToken) return res.status(403).json({ message: 'Scorer only' });

    const inn = match.innings[match.currentInnings - 1];
    if (!inn || !inn.ballByBall.length) return res.status(400).json({ message: 'No ball to undo' });
    // Simple approach: remove last ball and decrement counters
    const last = inn.ballByBall.pop();
    inn.runs -= last.runs + (last.isWide || last.isNoBall ? 1 : 0);
    if (last.isWide) inn.extras.wides -= 1 + last.runs;
    if (last.isNoBall) inn.extras.noBalls -= 1;
    if (!last.isWide && !last.isNoBall) {
      if (inn.balls === 0) { inn.overs = Math.max(0, inn.overs - 1); inn.balls = 5; } else inn.balls--;
    }
    if (last.isWicket) { inn.wickets = Math.max(0, inn.wickets - 1); inn.fallOfWickets.pop(); }

    match.updatedAt = new Date();
    match.markModified('innings');
    await match.save();
    res.json(match);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/cricket/matches/:id/abandon
router.patch('/matches/:id/abandon', async (req, res) => {
  try {
    const { visitorToken } = req.body;
    const match = await CricketMatch.findById(req.params.id);
    if (!match) return res.status(404).json({ message: 'Not found' });
    if (match.scorerToken !== visitorToken) return res.status(403).json({ message: 'Scorer only' });
    match.status = 'abandoned';
    match.updatedAt = new Date();
    await match.save();
    res.json({ message: 'Match abandoned' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

function _buildDesc(r, isWicket, isWide, isNoBall, isBye, isLegBye, striker, outDesc) {
  if (isWicket) return `WICKET! ${outDesc || striker + ' out'}`;
  if (isWide) return `Wide${r ? ` +${r}` : ''}`;
  if (isNoBall) return `No Ball${r ? ` +${r}` : ''}`;
  if (isBye) return `${r} Bye${r !== 1 ? 's' : ''}`;
  if (isLegBye) return `${r} Leg Bye${r !== 1 ? 's' : ''}`;
  if (r === 4) return '4 runs (boundary)';
  if (r === 6) return '6 runs (SIX!)';
  return `${r} run${r !== 1 ? 's' : ''}`;
}

function _calcResult(match) {
  const inn1 = match.innings[0];
  const inn2 = match.innings[1];
  if (!inn1 || !inn2) return 'Match ended';
  if (inn2.runs >= inn2.target) {
    const wktsLeft = (match.playersPerSide - 1) - inn2.wickets;
    return `${inn2.battingTeam} ने ${wktsLeft} विकेट से जीत दर्ज की`;
  }
  const diff = inn1.runs - inn2.runs;
  return `${inn1.battingTeam} ने ${diff} रन से जीत दर्ज की`;
}

module.exports = router;
