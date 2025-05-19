import React, { useEffect, useState } from "react";
import axios from "axios";

const Notifications = () => {
  const [notifications, setNotifications] = useState([]);
  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");

  const fetchNotifications = async () => {
    try {
      const res = await axios.get(`http://localhost:5000/api/v1/notifications/${currentUser.id}`);
      setNotifications(res.data);
    } catch (err) {
      console.error("Error fetching notifications", err);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  return (
    <div className="max-w-md mx-auto mt-6 p-4 bg-white rounded shadow">
      <h2 className="text-lg font-semibold mb-3">Notifications</h2>
      {notifications.length > 0 ? (
        notifications.map((n: any) => (
          <div key={n.id} className="border-b py-2">
            <p>
              <strong>From:</strong> {n.senderId}
            </p>
            <p>
              <strong>Message:</strong> {n.message}
            </p>
            <p className="text-sm text-gray-500">{new Date(n.createdAt).toLocaleString()}</p>
          </div>
        ))
      ) : (
        <p className="text-gray-500">No notifications yet</p>
      )}
    </div>
  );
};

export default Notifications;
