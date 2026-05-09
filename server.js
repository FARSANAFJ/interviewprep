const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const { Resend } = require("resend");
const Razorpay = require("razorpay");

const app = express();

app.use(cors());
app.use(express.json());

const OWNER_EMAIL = process.env.OWNER_EMAIL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MONGO_URI = process.env.MONGO_URI;

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const BOOKING_AMOUNT = Number(process.env.BOOKING_AMOUNT || 199);
const FREE_PROMO_CODE = process.env.FREE_PROMO_CODE || "LAUNCHFREE";

const resend = new Resend(RESEND_API_KEY);

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

let bookingsCollection;

async function connectDB() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db("interviewprep");
    bookingsCollection = db.collection("bookings");

    await bookingsCollection.createIndex(
        { date: 1, time: 1 },
        { unique: true }
    );

    console.log("MongoDB connected");
}

app.get("/", (req, res) => {
    res.send("InterviewPrep server is running");
});

app.get("/config", (req, res) => {
    res.json({
        razorpayKeyId: RAZORPAY_KEY_ID,
        bookingAmount: BOOKING_AMOUNT,
        currency: "INR"
    });
});

app.get("/slots/:date", async (req, res) => {
    try {
        const date = req.params.date;

        const bookings = await bookingsCollection.find({ date }).toArray();

        const bookedTimes = bookings.map(b => b.time);

        res.json({
            "5:00 PM": bookedTimes.includes("5:00 PM") ? "booked" : "available",
            "7:00 PM": bookedTimes.includes("7:00 PM") ? "booked" : "available"
        });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error" });
    }
});

app.get("/all-bookings", async (req, res) => {
    try {
        const bookings = await bookingsCollection
            .find()
            .sort({ createdAt: -1 })
            .toArray();

        res.json(bookings);

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/create-order", async (req, res) => {
    try {
        const { name, email, date, time, type, msg, promo } = req.body;

        if (!name || !email || !date || !time || !type) {
            return res.status(400).json({
                message: "Please fill all required fields"
            });
        }

        const validSlots = [
            "10:00 AM",
            "11:00 AM",
            "5:00 PM",
            "7:00 PM",
            "8:00 PM"
        ];

        if (!validSlots.includes(time)) {
            return res.status(400).json({
                message: "Invalid time slot"
            });
        }

        const alreadyBooked = await bookingsCollection.findOne({ date, time });

        if (alreadyBooked) {
            return res.status(400).json({
                message: "This time slot is already booked"
            });
        }

        const countForDate = await bookingsCollection.countDocuments({ date });

        if (countForDate >= 2) {
            return res.status(400).json({
                message: "This date is already fully booked"
            });
        }

        const promoCode = (promo || "").trim().toUpperCase();

        if (promoCode === FREE_PROMO_CODE.toUpperCase()) {
            return res.json({
                freeBooking: true,
                message: "Promo code applied. Booking is free."
            });
        }

        const amountInPaise = BOOKING_AMOUNT * 100;

        const order = await razorpay.orders.create({
            amount: amountInPaise,
            currency: "INR",
            receipt: "receipt_" + Date.now(),
            notes: {
                name,
                email,
                date,
                time,
                type
            }
        });

        console.log("Razorpay order created:", order.id);

        res.json({
            freeBooking: false,
            order
        });

    } catch (error) {
        console.log(error);
        res.status(500).json({
            message: "Could not create payment order"
        });
    }
});

async function sendBookingEmails(booking) {
    console.log("Sending owner email...");
    await resend.emails.send({
        from: "InterviewPrep <support@nextinterview.online>",
        to: OWNER_EMAIL,
        subject: "New Interview Booking",
        html: `
            <h2>New Interview Booking</h2>
            <p><b>Name:</b> ${booking.name}</p>
            <p><b>Email:</b> ${booking.email}</p>
            <p><b>Date:</b> ${booking.date}</p>
            <p><b>Time:</b> ${booking.time}</p>
            <p><b>Type:</b> ${booking.type}</p>
            <p><b>Payment Status:</b> ${booking.paymentStatus}</p>
            <p><b>Payment ID:</b> ${booking.paymentId || "N/A"}</p>
            <p><b>Message:</b> ${booking.msg || "Not provided"}</p>
            <p><b>Submitted At:</b> ${booking.submittedAt}</p>
        `
    });

    console.log("Sending client email...");
    await resend.emails.send({
        from: "InterviewPrep <support@nextinterview.online>",
        to: booking.email,
        subject: "Your Interview Booking is Confirmed",
        html: `
            <h2>Booking Confirmed</h2>
            <p>Dear ${booking.name},</p>
            <p>Your mock interview booking has been confirmed.</p>
            <p><b>Date:</b> ${booking.date}</p>
            <p><b>Time:</b> ${booking.time}</p>
            <p><b>Interview Type:</b> ${booking.type}</p>
            <p><b>Payment Status:</b> ${booking.paymentStatus}</p>
            <p>Thank you,<br>InterviewPrep</p>
        `
    });

    console.log("Emails sent successfully");
}

app.post("/book", async (req, res) => {
    try {
        console.log("Book API called");

        const {
            name,
            email,
            date,
            time,
            type,
            msg,
            promo,
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        } = req.body;

        if (!name || !email || !date || !time || !type) {
            return res.status(400).json({
                message: "Please fill all required fields"
            });
        }
        const validSlots = [
            "10:00 AM",
            "11:00 AM",
            "5:00 PM",
            "7:00 PM",
            "8:00 PM"
        ];

        if (!validSlots.includes(time)) {
            return res.status(400).json({
                message: "Invalid time slot"
            });
        }

        const alreadyBooked = await bookingsCollection.findOne({ date, time });

        if (alreadyBooked) {
            return res.status(400).json({
                message: "This time slot is already booked"
            });
        }

        const countForDate = await bookingsCollection.countDocuments({ date });

        if (countForDate >= 2) {
            return res.status(400).json({
                message: "This date is already fully booked"
            });
        }

        const promoCode = (promo || "").trim().toUpperCase();
        const isFreeBooking = promoCode === FREE_PROMO_CODE.toUpperCase();

        let paymentStatus = "PAID";
        let paymentId = razorpay_payment_id || "";

        if (!isFreeBooking) {
            console.log("Paid booking detected");
            console.log("Order ID:", razorpay_order_id);
            console.log("Payment ID:", razorpay_payment_id);

            if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
                console.log("Payment verification details missing");

                return res.status(400).json({
                    message: "Payment verification details missing"
                });
            }

            const generatedSignature = crypto
                .createHmac("sha256", RAZORPAY_KEY_SECRET)
                .update(razorpay_order_id + "|" + razorpay_payment_id)
                .digest("hex");

            console.log("Generated signature:", generatedSignature);
            console.log("Received signature :", razorpay_signature);

            if (generatedSignature !== razorpay_signature) {
                console.log("SIGNATURE FAILED");

                return res.status(400).json({
                    message: "Payment verification failed"
                });
            }

            console.log("Payment signature verified");
        } else {
            paymentStatus = "FREE_PROMO";
            paymentId = "PROMO-" + promoCode;
            console.log("Free promo booking detected");
        }

        const booking = {
            name,
            email,
            date,
            time,
            type,
            msg: msg || "",
            promo: promo || "",
            amount: isFreeBooking ? 0 : BOOKING_AMOUNT,
            paymentStatus,
            paymentId,
            razorpayOrderId: razorpay_order_id || "",
            submittedAt: new Date().toLocaleString(),
            createdAt: new Date()
        };

        console.log("BOOKING VERIFIED, SAVING...");
        await bookingsCollection.insertOne(booking);
        console.log("Booking saved to MongoDB");

        let emailSent = true;

        try {
            console.log("Trying to send emails for:", booking.email);
            await sendBookingEmails(booking);
        } catch (emailError) {
            emailSent = false;
            console.log("Booking saved, but email failed:");
            console.log(emailError);
        }

        res.json({
            message: emailSent
                ? "Booking confirmed successfully. Please check your email."
                : "Booking saved, but email could not be sent. Please check the email address.",
            emailSent
        });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({
                message: "This time slot was just booked. Please choose another slot."
            });
        }

        console.log(error);

        res.status(500).json({
            message: "Server error"
        });
    }
});

const PORT = process.env.PORT || 3000;

connectDB()
    .then(() => {
        app.listen(PORT, () => {
            console.log("Server running on port " + PORT);
        });
    })
    .catch(error => {
        console.log("MongoDB connection failed:");
        console.log(error);
    });