const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { Resend } = require("resend");

const app = express();

app.use(cors());
app.use(express.json());

const FILE = "bookings.json";

/* Render Environment Variables */
const OWNER_EMAIL = process.env.OWNER_EMAIL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const resend = new Resend(RESEND_API_KEY);

function readBookings() {
    if (!fs.existsSync(FILE)) return [];

    try {
        return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch {
        return [];
    }
}

function saveBookings(bookings) {
    fs.writeFileSync(FILE, JSON.stringify(bookings, null, 2));
}

app.get("/", (req, res) => {
    res.send("InterviewPrep server is running");
});

/* Check available slots */
app.get("/slots/:date", (req, res) => {
    const date = req.params.date;
    const bookings = readBookings();

    const bookedTimes = bookings
        .filter(b => b.date === date)
        .map(b => b.time);

    res.json({
        "5:00 PM": bookedTimes.includes("5:00 PM") ? "booked" : "available",
        "7:00 PM": bookedTimes.includes("7:00 PM") ? "booked" : "available"
    });
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

        const bookings = readBookings();

        const alreadyBooked = bookings.find(
            b => b.date === date && b.time === time
        );

        if (alreadyBooked) {
            return res.status(400).json({
                message: "This time slot is already booked"
            });
        }

        const booking = {
            id: Date.now(),
            name,
            email,
            date,
            time,
            type,
            msg: msg || "",
            submittedAt: new Date().toLocaleString()
        };

        bookings.push(booking);
        saveBookings(bookings);

        let emailSent = true;

        try {
            /* Email to owner */
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

            /* Email to client */
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

                    <p>Please check your email regularly for further updates.</p>

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

app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});