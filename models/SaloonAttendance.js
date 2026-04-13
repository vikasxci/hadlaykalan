const mongoose = require('mongoose');
const { Schema } = mongoose;

// Tracks each day an owner explicitly records staff attendance
const saloonAttendanceSchema = new Schema({
  saloon: { type: Schema.Types.ObjectId, ref: 'SaloonBusiness', required: true },
  staff:  { type: Schema.Types.ObjectId, ref: 'SaloonStaff',    required: true },
  date:   { type: Date, required: true },
  status: { type: String, enum: ['present', 'absent', 'half_day', 'leave'], default: 'present' },
  checkIn:  { type: String }, // "HH:MM"
  checkOut: { type: String },
  note:     { type: String, trim: true }
}, { timestamps: true });

saloonAttendanceSchema.index({ saloon: 1, staff: 1, date: 1 }, { unique: true });

module.exports = mongoose.models.SaloonAttendance ||
  mongoose.model('SaloonAttendance', saloonAttendanceSchema);
