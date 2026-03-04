const express = require('express');
const router = express.Router();
const Contest = require('../models/Contest');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

// ============ PUBLIC ROUTES ============

// GET all active & completed contests (public)
router.get('/', async (req, res) => {
  try {
    // Auto-complete expired contests
    const now = new Date();
    const expiredContests = await Contest.find({
      status: 'active',
      endsAt: { $lte: now }
    });
    for (const contest of expiredContests) {
      contest.declareWinner();
      await contest.save();
    }

    const contests = await Contest.find({
      $or: [
        { status: 'active', 'contestantA.isApproved': true, 'contestantB.isApproved': true },
        { status: 'completed' },
        { status: 'waiting', 'contestantA.isApproved': true }
      ]
    }).sort({ createdAt: -1 });

    // Strip voter IPs from public response
    const sanitized = contests.map(c => {
      const obj = c.toObject();
      if (obj.contestantA) delete obj.contestantA.voterIPs;
      if (obj.contestantB) delete obj.contestantB.voterIPs;
      delete obj.allVoterIPs;
      return obj;
    });

    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET single contest by ID (public)
router.get('/:id', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: 'Contest not found' });

    // Auto-complete if expired
    if (contest.status === 'active' && contest.endsAt && new Date() >= contest.endsAt) {
      contest.declareWinner();
      await contest.save();
    }

    const obj = contest.toObject();
    if (obj.contestantA) delete obj.contestantA.voterIPs;
    if (obj.contestantB) delete obj.contestantB.voterIPs;
    delete obj.allVoterIPs;
    res.json(obj);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST submit a contestant entry (public – user submits their photo)
// If there's a "waiting" contest, this person becomes contestant B
// Otherwise, a new contest is created with this person as contestant A
router.post('/enter', upload.single('image'), async (req, res) => {
  try {
    const { name, age, village, bio, contestType } = req.body;
    if (!name || !req.file) {
      return res.status(400).json({ message: 'Name and photo are required' });
    }

    const contestant = {
      name: name.trim(),
      age: age ? parseInt(age) : undefined,
      village: village ? village.trim() : '',
      bio: bio ? bio.trim() : '',
      image: req.file.path,
      cloudinaryId: req.file.filename,
      isApproved: false,
      votes: 0,
      voterIPs: []
    };

    const userContestType = contestType ? contestType.trim() : 'Photo Contest';

    // Check for a waiting contest (only has contestant A, no B yet)
    let contest = await Contest.findOne({
      status: 'waiting',
      'contestantA.isApproved': true
    });

    // Make sure contestantB doesn't already exist
    if (contest && contest.contestantB && contest.contestantB.name) {
      contest = null; // Already has opponent, create new contest
    }

    if (contest) {
      // Join existing contest as contestant B
      contest.contestantB = contestant;
      await contest.save();
      res.status(201).json({
        message: 'Entry submitted! Waiting for admin approval to start the battle.',
        contestId: contest._id,
        side: 'B'
      });
    } else {
      // Create new contest as contestant A
      const newContest = new Contest({
        contestantA: contestant,
        contestType: userContestType,
        title: userContestType,
        status: 'waiting'
      });
      await newContest.save();
      res.status(201).json({
        message: 'Entry submitted! Waiting for an opponent and admin approval.',
        contestId: newContest._id,
        side: 'A'
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST vote for a contestant (IP-restricted)
router.post('/:id/vote', async (req, res) => {
  try {
    const { side } = req.body; // 'A' or 'B'
    if (!side || !['A', 'B'].includes(side)) {
      return res.status(400).json({ message: 'Invalid vote. Choose A or B.' });
    }

    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: 'Contest not found' });
    if (contest.status !== 'active') {
      return res.status(400).json({ message: 'This contest is not active for voting.' });
    }

    // Check if expired
    if (contest.endsAt && new Date() >= contest.endsAt) {
      contest.declareWinner();
      await contest.save();
      return res.status(400).json({ message: 'Voting has ended for this contest.' });
    }

    // Get voter IP
    const voterIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                    req.connection?.remoteAddress ||
                    req.socket?.remoteAddress ||
                    req.ip;

    // Check if this IP already voted in this contest
    if (contest.allVoterIPs.includes(voterIP)) {
      return res.status(403).json({ message: 'You have already voted in this contest.', alreadyVoted: true });
    }

    // Apply vote
    if (side === 'A') {
      contest.contestantA.votes += 1;
      contest.contestantA.voterIPs.push(voterIP);
    } else {
      contest.contestantB.votes += 1;
      contest.contestantB.voterIPs.push(voterIP);
    }
    contest.allVoterIPs.push(voterIP);

    await contest.save();

    res.json({
      message: 'Vote recorded!',
      votesA: contest.contestantA.votes,
      votesB: contest.contestantB.votes
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET check if an IP has voted in a contest
router.get('/:id/check-vote', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: 'Contest not found' });

    const voterIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                    req.connection?.remoteAddress ||
                    req.socket?.remoteAddress ||
                    req.ip;

    const hasVoted = contest.allVoterIPs.includes(voterIP);
    let votedFor = null;
    if (hasVoted) {
      if (contest.contestantA.voterIPs.includes(voterIP)) votedFor = 'A';
      else if (contest.contestantB.voterIPs.includes(voterIP)) votedFor = 'B';
    }

    res.json({ hasVoted, votedFor });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============ ADMIN ROUTES ============

// GET all contests (admin – includes pending/unapproved)
router.get('/admin/all', auth, async (req, res) => {
  try {
    const contests = await Contest.find().sort({ createdAt: -1 });
    res.json(contests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT approve a contestant (admin)
// body: { side: 'A' or 'B' }
router.put('/admin/approve/:id', auth, async (req, res) => {
  try {
    const { side } = req.body;
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: 'Contest not found' });

    if (side === 'A' && contest.contestantA) {
      contest.contestantA.isApproved = true;
    } else if (side === 'B' && contest.contestantB) {
      contest.contestantB.isApproved = true;
    } else {
      return res.status(400).json({ message: 'Invalid side' });
    }

    // If both are approved, start the contest
    if (contest.contestantA?.isApproved && contest.contestantB?.isApproved) {
      contest.status = 'active';
      contest.startedAt = new Date();
      contest.endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24 hours
    }

    await contest.save();
    res.json({ message: `Contestant ${side} approved!`, contest });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT update contest title & type (admin)
router.put('/admin/:id', auth, async (req, res) => {
  try {
    const { title, contestType } = req.body;
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: 'Contest not found' });
    if (title) contest.title = title;
    if (contestType) contest.contestType = contestType;
    await contest.save();
    res.json({ message: 'Contest updated', contest });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE a contest (admin)
router.delete('/admin/:id', auth, async (req, res) => {
  try {
    const contest = await Contest.findByIdAndDelete(req.params.id);
    if (!contest) return res.status(404).json({ message: 'Contest not found' });
    res.json({ message: 'Contest deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT force-complete a contest (admin)
router.put('/admin/complete/:id', auth, async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: 'Contest not found' });
    contest.declareWinner();
    await contest.save();
    res.json({ message: 'Contest completed!', winner: contest.winner, contest });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
