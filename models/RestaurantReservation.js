const mongoose = require('mongoose');
const { Schema } = mongoose;

const restaurantReservationSchema = new Schema({
  restaurant:   { type: Schema.Types.ObjectId, ref: 'RestaurantBusiness', required: true },

  // Guest info
  guestName:    { type: String, required: true, trim: true },
  guestPhone:   { type: String, required: true, trim: true },
  guestEmail:   { type: String, trim: true, lowercase: true },
  partySize:    { type: Number, required: true, min: 1 },

  // When
  date:         { type: Date, required: true },
  time:         { type: String, required: true },   // "19:30"
  duration:     { type: Number, default: 90 },      // minutes

  // Where
  table:        { type: Schema.Types.ObjectId, ref: 'RestaurantTable' },
  area:         { type: String, trim: true },

  // Status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no-show'],
    default: 'pending'
  },

  // Details
  occasion:     { type: String, trim: true },   // birthday, anniversary, etc.
  notes:        { type: String, trim: true },
  specialRequests: { type: String, trim: true },

  // Internal
  confirmedBy:  { type: Schema.Types.ObjectId, ref: 'RestaurantStaff' },
  seatedBy:     { type: Schema.Types.ObjectId, ref: 'RestaurantStaff' },
  seatedAt:     { type: Date },
  linkedOrder:  { type: Schema.Types.ObjectId, ref: 'RestaurantOrder' },

  // Communication
  confirmationSent: { type: Boolean, default: false },
  reminderSent:     { type: Boolean, default: false }

}, { timestamps: true });

restaurantReservationSchema.index({ restaurant: 1, date: 1 });
restaurantReservationSchema.index({ restaurant: 1, status: 1 });
restaurantReservationSchema.index({ guestPhone: 1 });

module.exports = mongoose.model('RestaurantReservation', restaurantReservationSchema);
