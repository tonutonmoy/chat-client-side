import { io } from "socket.io-client";

const user = JSON.parse(localStorage.getItem("user") || "{}");

const socket = io("http://localhost:5000", {
  auth: {
    userId: user?.id,
  },
});

export default socket;
