import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const Users = () => {
  const [users, setUsers] = useState([]);
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get("http://localhost:5000/api/v1/users");
        const filteredUsers = currentUser?.id
          ? res.data.data.result.filter((user: any) => user.id !== currentUser.id)
          : res.data.data.result;

        setUsers(filteredUsers);
      } catch (error) {
        console.error("Failed to fetch users:", error);
      }
    };

    fetchUsers();
  }, [currentUser?.id]);



  return (
    <div className="h-screen flex flex-col bg-white max-w-md mx-auto shadow-lg">
      {/* Header */}
      {/* <div className="bg-green-600 text-white p-4 text-lg font-bold">
        {currentUser?.firstName}'s Chats
      </div> */}

      {/* User List */}
      <div className="flex-1 overflow-y-auto">
        {users.length > 0 ? (
          users.map((user: any) => (
            <div
              key={user.id}
              className="flex items-center gap-4 p-4 border-b hover:bg-gray-100 cursor-pointer"
              onClick={() => navigate(`/chat/${user.id}`)}
            >
              <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-white font-semibold">
                {user.firstName.charAt(0)}
              </div>
              <div>
                <div className="font-medium">{user.firstName} {user.lastName}</div>
                <div className="text-sm text-gray-500">Tap to chat</div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-center text-gray-500 mt-4">No users available</p>
        )}
      </div>
    </div>
  );
};

export default Users;
