const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const { Resend } = require("resend");

const app = express();

app.use(cors());
app.use(express.json());

const OWNER_EMAIL = process.env.OWNER_EMAIL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MONGO_URI = process.env.MONGO_URI;

const resend = new Resend(RESEND_API_KEY);

let bookingsCollection;

async function connectDB() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db("interviewprep");
    bookingsCollection = db.collection("bookings");

    console.log("MongoDB connected");
}

app.get("/", (req, res) => {
    res.send("InterviewPrep server is running");
});

/* Check available slots */
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

/* View all bookings */
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

/* Book appointment */
app.post("/book", async (req, res) => {
    try {
        const { name, email, date, time, type, msg } = req.body;

        if (!name || !email || !date || !time || !type) {
            return res.status(400).json({
                message: "Please fill all required fields"
            });
        }

        if (time !== "5:00 PM" && time !== "7:00 PM") {
            return res.status(400).json({
                message: "Invalid time slot"
            });
        }

        const alreadyBooked = await bookingsCollection.findOne({
            date,
            time
        });

        if (alreadyBooked) {
            return res.status(400).json({
                message: "This time slot is already booked"
            });
        }

        const countForDate = await bookingsCollection.countDocuments({
            date
        });

        if (countForDate >= 2) {
            return res.status(400).json({
                message: "This date is already fully booked"
            });
        }

        const booking = {
            name,
            email,
            date,
            time,
            type,
            msg: msg || "",
            submittedAt: new Date().toLocaleString(),
            createdAt: new Date()
        };

        await bookingsCollection.insertOne(booking);

        let emailSent = true;

        try {
            await resend.emails.send({
                from: "InterviewPrep <onboarding@resend.dev>",
                to: OWNER_EMAIL,
                subject: "New Interview Booking",
                html: `
                    <h2>New Interview Booking</h2>
                    <p><b>Name:</b> ${booking.name}</p>
                    <p><b>Email:</b> ${booking.email}</p>
                    <p><b>Date:</b> ${booking.date}</p>
                    <p><b>Time:</b> ${booking.time}</p>
                    <p><b>Type:</b> ${booking.type}</p>
                    <p><b>Message:</b> ${booking.msg || "Not provided"}</p>
                    <p><b>Submitted At:</b> ${booking.submittedAt}</p>
                `
            });

            await resend.emails.send({
                from: "InterviewPrep <onboarding@resend.dev>",
                to: email,
                subject: "Your Interview Booking is Confirmed",
                html: `
                    <h2>Booking Confirmed</h2>
                    <p>Dear ${booking.name},</p>
                    <p>Your mock interview booking has been confirmed.</p>
                    <p><b>Date:</b> ${booking.date}</p>
                    <p><b>Time:</b> ${booking.time}</p>
                    <p><b>Interview Type:</b> ${booking.type}</p>
                    <p>Thank you,<br>InterviewPrep</p>
                `
            });

        } catch (emailError) {
            emailSent = false;
            console.log("Booking saved, but email failed:");
            console.log(emailError.message);
        }

        res.json({
            message: emailSent
                ? "Booking confirmed successfully. Please check your email."
                : "Booking saved, but email could not be sent. Please check the email address.",
            emailSent
        });

    } catch (error) {
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