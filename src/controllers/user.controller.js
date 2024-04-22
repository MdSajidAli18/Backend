import { asyncHandler } from "../utils/asyncHandler.js";

import {ApiError} from "../utils/ApiError.js";

import {User} from "../models/user.model.js";

import {uploadOnCloudinary} from "../utils/cloudinary.js";

import {ApiResponse} from "../utils/ApiResponse.js";



const registerUser = asyncHandler( async (req, res) => {
    //<-- We will do this step by step: -->

    // (a) get user details from the frontend
    // (b) details validation- whether the details are given or not by the user
    // (c) check if user already exists. (Check with the help of username or email)
    // (d) check for images, check for avatar
    // (e) upload images and avatar to Cloudinary. (For upload confirmation check avatar)
    // (f) create user object  - create entry in db
    // (g) remove pasword and refresh token field from response
    // (h) check for user creation
    // (i) return res

    // (a)
    const {fullName, email, username, password} = req.body
    //console.log("email: ", email);

    // (b)
    if(
        [fullName, email, username, password].some((field) => field?.trim() === "")
    ){
        throw new ApiError(400, "All fields are required")
    }


    // (c)
    const existedUser = await User.findOne({ $or:[{username}, {email}] })

    if(existedUser){
        throw new ApiError(409, "User with email or username already exists")
    }

    //console.log(req.files)


    // (d)
    const avatarLocalPath =  req.files?.avatar[0]?.path;
    //const coverImageLocalPath =  req.files?.coverImage[0]?.path;
    let coverImageLocalPath;
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required")
    }


    // (e)
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!avatar) {
        throw new ApiError(400, "Avatar file is required")
    }


    // (f)
    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })


    // (g)
    const createdUser = await User.findById(user._id).select( " -password -refreshToken " )
    // (h)
    if(!createdUser){
        throw new ApiError(500, "Something went wrong while registering the user")
    }


    //(i)
    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered Successfully")
    )

})


export {registerUser}