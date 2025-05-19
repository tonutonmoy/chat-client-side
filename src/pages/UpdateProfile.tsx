import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

const Profile = () => {
  const [userData, setUserData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    profileImage: "",
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showPopup, setShowPopup] = useState(false);

  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");

  useEffect(() => {
    if (!currentUser?.id) return;

    const fetchUser = async () => {
      try {
        const res = await axios.get(
          `http://localhost:5000/api/v1/users/${currentUser.id}`
        );
        const user = res.data.data;
        setUserData({
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          profileImage: user.profileImage || "",
        });

        setPreview(user.profileImage || null);
      } catch (error) {
        toast.error("Failed to fetch user info.");
        console.error(error);
      }
    };

    fetchUser();
  }, [currentUser.id]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setPreview(URL.createObjectURL(file));
      setShowPopup(true);
    }
  };

  const uploadImage = async () => {
    if (!imageFile) return;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("upload", imageFile);

      const res = await axios.post("http://localhost:5000/api/v1/upload", formData);
      const imageUrl = res.data.url;

      const updateRes = await axios.put(
        `http://localhost:5000/api/v1/users/update-profile/${currentUser.id}`,
        { profileImage: imageUrl }
      );

      localStorage.setItem("user", JSON.stringify(updateRes.data.data));
      setUserData((prev) => ({ ...prev, profileImage: imageUrl }));
      setPreview(imageUrl);

      toast.success("Profile image updated successfully!");
      setShowPopup(false);
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserData({ ...userData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.put(
        `http://localhost:5000/api/v1/users/update-profile/${currentUser.id}`,
        userData
      );
      localStorage.setItem("user", JSON.stringify(res.data.data));
      toast.success("Profile updated successfully!");
    } catch (err) {
      console.error("Failed to update profile:", err);
      toast.error("Error updating profile");
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 bg-white p-6 rounded-xl shadow-lg">
      <h1 className="text-2xl font-bold text-center mb-4 text-green-700">
        My Profile
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex justify-center">
          {userData?.profileImage ? (
            <img
              src={userData?.profileImage}
              alt="Profile"
              className="w-24 h-24 rounded-full object-cover border-2 border-green-600"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
              No Image
            </div>
          )}
        </div>

        <div className="text-center">
          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="mt-2"
          />
        </div>

        {imageFile && (
          <button
            type="button"
            onClick={uploadImage}
            disabled={uploading}
            className="block w-full mt-2 bg-blue-600 text-white font-semibold py-2 rounded hover:bg-blue-700"
          >
            {uploading ? "Uploading..." : "Upload Image"}
          </button>
        )}

        <div>
          <label className="text-sm font-medium text-gray-600">First Name</label>
          <input
            type="text"
            name="firstName"
            value={userData.firstName}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2 mt-1"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-600">Last Name</label>
          <input
            type="text"
            name="lastName"
            value={userData.lastName}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2 mt-1"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-600">Email</label>
          <input
            type="email"
            name="email"
            value={userData.email}
            readOnly
            className="w-full border bg-gray-100 cursor-not-allowed rounded px-3 py-2 mt-1"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded"
        >
          Update Profile
        </button>
      </form>

      {showPopup && preview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg text-center">
            <h2 className="text-lg font-semibold mb-2">Preview Image</h2>
            <img
              src={preview}
              alt="Preview"
              className="w-32 h-32 mx-auto rounded-full object-cover mb-4 border"
            />
            <div className="flex justify-center gap-4">
              <button
                onClick={() => setShowPopup(false)}
                className="bg-gray-300 px-4 py-1 rounded"
              >
                Cancel
              </button>
              <button
                onClick={uploadImage}
                className="bg-blue-600 text-white px-4 py-1 rounded hover:bg-blue-700"
              >
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
