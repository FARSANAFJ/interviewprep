const express = require("express");
const cors = require("cors");
const fs = require("fs");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());

const FILE = "bookings.json";

/* CHANGE THESE */
const OWNER_EMAIL = "farsanafarooq@gmail.com";
const GMAIL_APP_PASSWORD = "zurqsfrspnkewrey";

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

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: OWNER_EMAIL,
        pass: GMAIL_APP_PASSWORD
    }
});

app.get("/", (req, res) => {
    res.send("InterviewPrep server is running");
});

/* CHECK AVAILABLE SLOTS */
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

/* BOOK APPOINTMENT */
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

        const countForDate = bookings.filter(b => b.date === date).length;

        if (countForDate >= 2) {
            return res.status(400).json({
                message: "This date is already fully booked"
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
            await transporter.sendMail({
                from: OWNER_EMAIL,
                to: OWNER_EMAIL,
                subject: "New Interview Booking",
                text: `
New interview booking received.

Name: ${booking.name}
Email: ${booking.email}
Date: ${booking.date}
Time: ${booking.time}
Type: ${booking.type}
Message: ${booking.msg}
Submitted At: ${booking.submittedAt}
                `
            });

            await transporter.sendMail({
                from: OWNER_EMAIL,
                to: booking.email,
                subject: "Your Interview Booking is Confirmed",
                text: `
Dear ${booking.name},

Your mock interview booking has been confirmed.

Date: ${booking.date}
Time: ${booking.time}
Interview Type: ${booking.type}

Please check your email regularly for further updates.

Thank you,
InterviewPrep
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